import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, qrImageUrl, type Booking, type MessageTemplate, type MessageTemplateKind, type Screening } from "../api";
import { formatEndsAt } from "../lib/screening";
import { useUI } from "../ui";

/** Форматирование «локального наивного» времени (например, starts_at — оно уже хранится
 *  в локальном времени крыши, без timezone-маркера). Просто парсим компоненты строки
 *  и выводим как есть в часовом поясе крыши. */
function fmtNaiveLocal(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня",
                  "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const [, y, mo, d, hh, mm] = m;
  return `${parseInt(d, 10)} ${months[parseInt(mo, 10) - 1]} ${y} г., ${hh}:${mm}`;
}

/** Форматирование UTC-времени (например, expires_at — хранится как datetime.utcnow())
 *  в указанной часовой зоне. Если строка пришла без 'Z', добавляем его — иначе JS
 *  посчитает её локальной для браузера и сдвинет на разницу с UTC. */
function fmtUtcInTz(iso: string, tz: string): string {
  const utcIso = iso.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  return new Date(utcIso).toLocaleString("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: tz,
  });
}

type Props = {
  booking: Booking;
};

const PAID_STATUSES = new Set(["paid", "paid_by_balance", "attended"]);

/** Карточка для админа на странице брони: 2 кнопки копирования шаблонов
 *  (до оплаты / после оплаты с QR и кодом). */
export default function AdminTemplateCopyBox({ booking }: Props) {
  const { notify } = useUI();
  const [templates, setTemplates] = useState<Record<MessageTemplateKind, MessageTemplate[]>>(
    {} as Record<MessageTemplateKind, MessageTemplate[]>,
  );
  const [screening, setScreening] = useState<Screening | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<MessageTemplate[]>("/api/admin/message-templates?kind=manual_booking").catch(() => []),
      api.get<MessageTemplate[]>("/api/admin/message-templates?kind=post_payment").catch(() => []),
      api.get<Screening>(`/api/screenings/${booking.screening_id}`).catch(() => null),
    ]).then(([m, p, s]) => {
      setTemplates({ manual_booking: m, post_payment: p } as any);
      setScreening(s);
    });
  }, [booking.id]);

  const info = booking.screening_info;
  if (!info) return null;
  const isPaid = PAID_STATUSES.has(booking.status);

  function buildPayoutDetails(): string {
    const pt = screening?.payout_template;
    if (!pt) return "";
    const lines: string[] = [];
    lines.push(`Получатель: ${pt.recipient_name}`);
    if (pt.card_number) lines.push(`Карта: ${pt.card_number}`);
    if (pt.phone) lines.push(`Телефон (СБП): ${pt.phone}`);
    if (pt.bank_name) lines.push(`Банк: ${pt.bank_name}`);
    if (pt.note) lines.push(pt.note);
    return lines.join("\n");
  }

  function buildItems(): string {
    if (!booking.items || booking.items.length === 0) return "";
    return booking.items
      .filter((item) => item.qty > 0)
      .map((item) => {
        const total = (item.qty * item.price_each).toLocaleString("ru-RU");
        return `${item.name} ×${item.qty} — ${total} ₽`;
      })
      .join("\n");
  }

  function pickDefault(kind: MessageTemplateKind): MessageTemplate | null {
    const list = templates[kind] || [];
    if (list.length === 0) return null;
    return list.find((t) => t.is_default) ?? list[0];
  }

  async function copyTemplate(kind: MessageTemplateKind) {
    const tpl = pickDefault(kind);
    if (!tpl) {
      await notify({
        title: "Нет шаблона",
        message: `Создайте шаблон типа «${kind === "manual_booking" ? "Ручное бронирование" : "После оплаты"}» в разделе «Шаблоны».`,
        kind: "error",
      });
      return;
    }
    const tz = info!.city_timezone || "Europe/Moscow";
    const endsAtText = formatEndsAt(
      {
        starts_at: info!.starts_at,
        ends_at: info!.ends_at,
        duration_min: info!.movie_duration_min,
      },
      true,
    ) ?? "";
    const ctx: Record<string, string> = {
      full_name: booking.full_name,
      movie: info!.movie_title,
      starts_at: fmtNaiveLocal(info!.starts_at),
      ends_at: endsAtText,
      rooftop: info!.rooftop_name,
      city: info!.city_name,
      rooftop_address: info!.rooftop_address ?? "(адрес будет в сообщении после оплаты)",
      amount: Number(booking.total_amount).toFixed(0),
      expires_at: fmtUtcInTz(booking.expires_at, tz),
      booking_link: `${window.location.origin}/bookings/${booking.id}`,
      claim_link: "",
      short_code: booking.short_code,
      qr_image_link: qrImageUrl(booking.qr_token, true),
      payout_details: buildPayoutDetails(),
      items: buildItems(),
    };
    try {
      const res = await api.post<{ rendered: string }>("/api/admin/message-templates/preview", {
        text: tpl.text,
        context: ctx,
      });
      await navigator.clipboard.writeText(res.rendered);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2500);
    } catch (e: any) {
      await notify({ title: "Ошибка", message: e.message, kind: "error" });
    }
  }

  const manualTpl = pickDefault("manual_booking");
  const postTpl = pickDefault("post_payment");

  return (
    <div className="card admin-tpl-box" style={{ marginTop: 12, borderColor: "var(--accent)" }}>
      <h3 style={{ marginTop: 0 }}>🛠 Админ: сообщения пользователю</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        Готовые шаблоны для копирования и отправки в Telegram/WhatsApp/SMS. Все плейсхолдеры подставятся автоматически.
      </p>
      <div className="row gap" style={{ flexWrap: "wrap", marginTop: 8 }}>
        <button
          className="primary"
          onClick={() => copyTemplate("manual_booking")}
          disabled={!manualTpl}
          title={!manualTpl ? "Шаблон не настроен" : (manualTpl.name)}
        >
          {copied === "manual_booking" ? "✓ Скопировано" : "📋 Для оплаты"}
        </button>
        <button
          className="primary"
          onClick={() => copyTemplate("post_payment")}
          disabled={!postTpl || !isPaid}
          title={
            !postTpl
              ? "Шаблон «После оплаты» не настроен"
              : !isPaid
                ? "Доступно только для оплаченной брони"
                : postTpl.name
          }
        >
          {copied === "post_payment" ? "✓ Скопировано" : "📋 После оплаты (QR)"}
        </button>
        <Link to="/admin/templates" className="ghost btn-as-link">Шаблоны →</Link>
      </div>

      {isPaid && booking.qr_token && (
        <div className="row gap" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <img
            src={qrImageUrl(booking.qr_token)}
            alt="QR-код брони"
            width={120}
            height={120}
            style={{ background: "#fff", padding: 6, borderRadius: 8, flexShrink: 0 }}
          />
          <div className="muted" style={{ fontSize: 12, maxWidth: 260 }}>
            QR-код для входа. Можно сохранить картинку и отправить гостю напрямую.
            В письме «После оплаты» он встроен автоматически.
            <div style={{ marginTop: 4 }}>
              Код входа: <b>{booking.short_code}</b>
            </div>
          </div>
        </div>
      )}

      {(!manualTpl || !postTpl) && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {!manualTpl && <>Не настроен шаблон «Ручное бронирование». </>}
          {!postTpl && <>Не настроен шаблон «После оплаты». </>}
          <Link to="/admin/templates" className="rooftop-link">Создать в разделе «Шаблоны» →</Link>
        </p>
      )}
    </div>
  );
}
