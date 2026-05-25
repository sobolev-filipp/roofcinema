import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Booking, type MessageTemplate, type MessageTemplateKind } from "../api";
import { useUI } from "../ui";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

const qrImageUrl = (token: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&qzone=1&color=111111&bgcolor=ffffff&data=${encodeURIComponent(token)}`;

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
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<MessageTemplate[]>("/api/admin/message-templates?kind=manual_booking").catch(() => []),
      api.get<MessageTemplate[]>("/api/admin/message-templates?kind=post_payment").catch(() => []),
    ]).then(([m, p]) => {
      setTemplates({ manual_booking: m, post_payment: p } as any);
    });
  }, [booking.id]);

  const info = booking.screening_info;
  if (!info) return null;
  const isPaid = PAID_STATUSES.has(booking.status);

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
    const ctx: Record<string, string> = {
      full_name: booking.full_name,
      movie: info!.movie_title,
      starts_at: fmt(info!.starts_at),
      rooftop: info!.rooftop_name,
      city: info!.city_name,
      rooftop_address: info!.rooftop_address ?? "(адрес будет в сообщении после оплаты)",
      amount: Number(booking.total_amount).toFixed(0),
      expires_at: fmt(booking.expires_at),
      booking_link: `${window.location.origin}/bookings/${booking.id}`,
      claim_link: "",
      short_code: booking.short_code,
      qr_image_link: qrImageUrl(booking.qr_token),
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
