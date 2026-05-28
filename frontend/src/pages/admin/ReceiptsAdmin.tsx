import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, getToken, type PaymentReceiptAdmin } from "../../api";
import { Skeleton, Spinner } from "../../components/Loaders";
import { useUI } from "../../ui";

type Tab = "pending" | "approved" | "rejected";
type Section = "incoming" | "to_send";
type ToSendTab = "to_send" | "sent";

const TAB_LABEL: Record<Tab, string> = {
  pending: "На проверке",
  approved: "Подтверждённые",
  rejected: "Отклонённые",
};
const TO_SEND_TAB_LABEL: Record<ToSendTab, string> = {
  to_send: "Ждут отправки",
  sent: "Отправленные",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

/** Лёгкая структура брони для пост-чеков (приходит из /api/admin/post-show-receipts/...) */
type PostShowBooking = {
  id: number;
  full_name: string;
  email: string;
  short_code: string;
  total_amount: number;
  needs_post_show_receipt: boolean;
  status: string;
  items: { name: string; qty: number; price_each: number }[];
  screening: {
    id: number | null;
    starts_at: string | null;
    ends_at: string | null;
    movie_title: string | null;
    movie_duration_min: number | null;
    rooftop_name: string | null;
    city_name: string | null;
  } | null;
  post_show_receipt: {
    id: number;
    file_url: string;
    sent_at: string | null;
    created_at: string;
  } | null;
};

export default function ReceiptsAdmin() {
  const [section, setSection] = useState<Section>("incoming");
  const [toSendCount, setToSendCount] = useState<number>(0);

  // Подгружаем количество для бейджа «Чеки для отправки» — обновляем при любых
  // действиях через ключ refreshTick.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api.get<{ count: number }>("/api/admin/post-show-receipts/pending-count")
      .then((r) => { if (alive) setToSendCount(r.count || 0); })
      .catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, [refreshTick]);

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Чеки</h2>

      {/* Верхний переключатель раздела */}
      <div className="seg" style={{ marginTop: 12, marginBottom: 16 }}>
        <button
          type="button"
          className={section === "incoming" ? "active" : ""}
          onClick={() => setSection("incoming")}
        >
          Входящие
        </button>
        <button
          type="button"
          className={section === "to_send" ? "active" : ""}
          onClick={() => setSection("to_send")}
        >
          Чеки для отправки
          {toSendCount > 0 && (
            <span className="admin-tab-badge" style={{ marginLeft: 6 }}>{toSendCount}</span>
          )}
        </button>
      </div>

      {section === "incoming"
        ? <IncomingReceipts />
        : <PostShowReceipts onChange={() => setRefreshTick((x) => x + 1)} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//   ВХОДЯЩИЕ (чеки оплаты от пользователей — без изменений)
// ────────────────────────────────────────────────────────────────────

function IncomingReceipts() {
  const { confirm, notify } = useUI();
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<PaymentReceiptAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function reload() {
    setLoading(true);
    setErr(null);
    try {
      const list = await api.get<PaymentReceiptAdmin[]>(`/api/admin/receipts?status=${tab}`);
      setItems(list);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, [tab]); // eslint-disable-line

  async function approve(r: PaymentReceiptAdmin) {
    const ok = await confirm({
      title: "Подтвердить оплату?",
      message: `Бронь #${r.booking_id} (${r.booking_full_name}) на ${Number(r.booking_total_amount).toFixed(0)} ₽ станет оплаченной.`,
      confirmText: "Подтвердить",
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      await api.post(`/api/admin/receipts/${r.id}/approve`);
      await reload();
    } catch (e: any) {
      await notify({ title: "Ошибка", message: e.message, kind: "error" });
    } finally {
      setBusyId(null);
    }
  }

  const [rejectModal, setRejectModal] = useState<{ r: PaymentReceiptAdmin; reason: string } | null>(null);
  async function startReject(r: PaymentReceiptAdmin) {
    setRejectModal({ r, reason: "" });
  }
  async function submitReject() {
    if (!rejectModal) return;
    const reason = rejectModal.reason.trim();
    if (!reason) {
      await notify({ title: "Укажите причину", message: "Пользователь увидит этот текст в письме и на странице брони.", kind: "error" });
      return;
    }
    const { r } = rejectModal;
    setRejectModal(null);
    setBusyId(r.id);
    try {
      await api.post(`/api/admin/receipts/${r.id}/reject`, { reason });
      await reload();
    } catch (e: any) {
      await notify({ title: "Ошибка", message: e.message, kind: "error" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="seg" style={{ marginBottom: 16 }}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? (
        <Skeleton variant="row" count={4} />
      ) : items.length === 0 ? (
        <div className="empty">Чеков в этой вкладке нет.</div>
      ) : (
        <div className="receipts-grid">
          {items.map((r) => (
            <div key={r.id} className="card receipt-card">
              <div className="receipt-thumb">
                <button
                  type="button"
                  className="receipt-open-btn"
                  onClick={() => window.open(r.image_url, "_blank", "noopener,noreferrer")}
                  title="Открыть чек в новой вкладке"
                >
                  {r.image_url.toLowerCase().endsWith(".pdf") ? (
                    <div className="pdf-thumb">PDF<br /><span className="muted" style={{ fontSize: 12 }}>открыть ↗</span></div>
                  ) : (
                    <img src={r.image_url} alt="чек" />
                  )}
                </button>
              </div>
              <button
                type="button"
                className="ghost"
                style={{ fontSize: 12, width: "100%" }}
                onClick={() => window.open(r.image_url, "_blank", "noopener,noreferrer")}
              >
                Открыть чек в новой вкладке ↗
              </button>

              <div className="receipt-meta">
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  <Link to={`/bookings/${r.booking_id}`} className="rooftop-link">
                    #{r.booking_id} · {r.booking_full_name}
                  </Link>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{r.booking_email}</div>
                <div style={{ marginTop: 8, fontSize: 14 }}>
                  <b>{r.movie_title}</b>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {fmt(r.screening_starts_at)} · {r.rooftop_name}
                </div>
                <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700 }}>
                  {Number(r.booking_total_amount).toFixed(0)} ₽
                  {Number(r.booking_balance_used) > 0 && (
                    <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                      (с баланса: {Number(r.booking_balance_used).toFixed(0)})
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Загружен {fmt(r.uploaded_at)}
                </div>
                {r.amount_claimed != null && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Заявлено пользователем: {Number(r.amount_claimed).toFixed(0)} ₽
                  </div>
                )}
                {r.rejection_reason && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <b>Причина отказа:</b> {r.rejection_reason}
                  </div>
                )}

                {tab === "pending" && (
                  <div className="row gap" style={{ marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      className="primary"
                      onClick={() => approve(r)}
                      disabled={busyId === r.id}
                    >
                      Подтвердить
                    </button>
                    <button
                      className="ghost danger-on-hover"
                      onClick={() => startReject(r)}
                      disabled={busyId === r.id}
                    >
                      Отклонить
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rejectModal && (
        <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={() => setRejectModal(null)}>
          <div className="ui-dialog" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-dialog-title">Отклонить чек?</h3>
            <div className="ui-dialog-body">
              Бронь #{rejectModal.r.booking_id} ({rejectModal.r.booking_full_name}).
              Укажите причину — пользователь получит её в письме и сможет загрузить новый чек.
            </div>
            <textarea
              autoFocus
              rows={3}
              value={rejectModal.reason}
              onChange={(e) => setRejectModal({ r: rejectModal.r, reason: e.target.value })}
              placeholder="Например: оплата на другую карту / сумма меньше / неполный скриншот"
              style={{ marginTop: 12, width: "100%" }}
            />
            <div className="ui-dialog-actions">
              <button type="button" className="ghost" onClick={() => setRejectModal(null)}>Отмена</button>
              <button type="button" className="primary danger" onClick={submitReject}>Отклонить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//   ЧЕКИ ДЛЯ ОТПРАВКИ (новая секция)
// ────────────────────────────────────────────────────────────────────

function PostShowReceipts({ onChange }: { onChange?: () => void }) {
  const { notify } = useUI();
  const [tab, setTab] = useState<ToSendTab>("to_send");
  const [items, setItems] = useState<PostShowBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  async function reload() {
    setLoading(true);
    setErr(null);
    try {
      const path = tab === "to_send" ? "to-send" : "sent";
      const list = await api.get<PostShowBooking[]>(`/api/admin/post-show-receipts/${path}`);
      setItems(list);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, [tab]); // eslint-disable-line

  async function uploadAndSend(b: PostShowBooking, file: File) {
    setBusyId(b.id);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const token = getToken();
      const res = await fetch(`/api/admin/post-show-receipts/${b.id}/send`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Ошибка ${res.status}`);
      // Если показ ещё не закончился — backend сообщает deferred=true: чек уйдёт автоматом
      const isDeferred = !!data.deferred;
      await notify({
        title: isDeferred ? "Чек сохранён" : "Чек отправлен",
        message: isDeferred
          ? "Письмо уйдёт автоматически после окончания показа."
          : `Письмо ушло на ${b.email}.`,
        kind: "success",
      });
      await reload();
      onChange?.();
    } catch (e: any) {
      await notify({ title: "Не удалось сохранить", message: e.message, kind: "error" });
    } finally {
      setBusyId(null);
    }
  }

  function onPick(b: PostShowBooking) {
    fileInputs.current[b.id]?.click();
  }

  return (
    <div>
      <div className="seg" style={{ marginBottom: 16 }}>
        {(Object.keys(TO_SEND_TAB_LABEL) as ToSendTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {TO_SEND_TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}

      <div className="hint-box" style={{ marginBottom: 12, fontSize: 13 }}>
        Здесь брони, у которых пользователь попросил прислать чек. Загрузите файл (PDF/JPG/PNG, до 10 МБ)
        и нажмите «Сохранить». Если показ ещё не закончился — чек автоматически отправится
        пользователю сразу после окончания. Если уже закончился — письмо уйдёт немедленно.
      </div>

      {loading ? (
        <Skeleton variant="row" count={4} />
      ) : items.length === 0 ? (
        <div className="empty">
          {tab === "to_send" ? "Нет броней, ожидающих отправки чека." : "Пока ничего не отправлено."}
        </div>
      ) : (
        <div className="receipts-grid">
          {items.map((b) => {
            const isBusy = busyId === b.id;
            const sentAt = b.post_show_receipt?.sent_at ?? null;
            const fileUploaded = !!b.post_show_receipt?.file_url;
            // Расчётное окончание показа — backend уже его прислал
            const endsAt = b.screening?.ends_at ? new Date(b.screening.ends_at) : null;
            const showEnded = endsAt ? endsAt.getTime() <= Date.now() : false;

            // Визуальный статус
            let statusBlock: JSX.Element;
            if (sentAt) {
              statusBlock = (
                <div className="psr-status psr-status-sent">
                  <span className="psr-status-icon">✓</span>
                  <div>
                    <div className="psr-status-title">Чек отправлен</div>
                    <div className="psr-status-sub">{fmt(sentAt)} → {b.email}</div>
                  </div>
                </div>
              );
            } else if (fileUploaded && !showEnded) {
              statusBlock = (
                <div className="psr-status psr-status-queued">
                  <span className="psr-status-icon">⏳</span>
                  <div>
                    <div className="psr-status-title">Чек загружен — ждёт окончания показа</div>
                    <div className="psr-status-sub">
                      Письмо уйдёт автоматически {endsAt ? `≈ ${fmt(endsAt.toISOString())}` : "после окончания"} на {b.email}
                    </div>
                  </div>
                </div>
              );
            } else if (fileUploaded && showEnded) {
              statusBlock = (
                <div className="psr-status psr-status-pending-send">
                  <span className="psr-status-icon">📨</span>
                  <div>
                    <div className="psr-status-title">Чек загружен — отправится в ближайшие минуты</div>
                    <div className="psr-status-sub">
                      Показ закончился. Автоотправка проходит раз в 5 минут.
                    </div>
                  </div>
                </div>
              );
            } else if (!fileUploaded && showEnded) {
              statusBlock = (
                <div className="psr-status psr-status-overdue">
                  <span className="psr-status-icon">⚠</span>
                  <div>
                    <div className="psr-status-title">Чек не загружен — показ уже закончился</div>
                    <div className="psr-status-sub">
                      Загрузите файл — письмо уйдёт сразу.
                    </div>
                  </div>
                </div>
              );
            } else {
              // file не загружен, показ ещё не прошёл
              statusBlock = (
                <div className="psr-status psr-status-waiting">
                  <span className="psr-status-icon">📎</span>
                  <div>
                    <div className="psr-status-title">Чек ещё не загружен</div>
                    <div className="psr-status-sub">
                      Загрузите файл до окончания показа{endsAt ? ` (${fmt(endsAt.toISOString())})` : ""} — он отправится автоматически.
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={b.id} className="card receipt-card">
                <div className="receipt-meta" style={{ padding: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    <Link to={`/bookings/${b.id}`} className="rooftop-link">
                      #{b.id} · {b.full_name}
                    </Link>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{b.email}</div>
                  {b.screening?.movie_title && (
                    <>
                      <div style={{ marginTop: 8, fontSize: 14 }}>
                        <b>{b.screening.movie_title}</b>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {b.screening.starts_at && fmt(b.screening.starts_at)} · {b.screening.rooftop_name}
                        {b.screening.city_name && `, ${b.screening.city_name}`}
                      </div>
                    </>
                  )}
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    {b.items.map((it, i) => (
                      <div key={i}>
                        {it.name} ×{it.qty}
                        <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                          {(it.qty * it.price_each).toFixed(0)} ₽
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700 }}>
                    {Number(b.total_amount).toFixed(0)} ₽
                  </div>

                  {/* Визуальный статус (один из 5 возможных вариантов) */}
                  <div style={{ marginTop: 12 }}>{statusBlock}</div>

                  {/* Ссылка на загруженный файл — есть для всех загруженных */}
                  {fileUploaded && b.post_show_receipt?.file_url && (
                    <a
                      href={b.post_show_receipt.file_url}
                      target="_blank"
                      rel="noopener"
                      className="rooftop-link"
                      style={{ fontSize: 12, display: "inline-block", marginTop: 8 }}
                    >
                      📄 Открыть файл чека ↗
                    </a>
                  )}

                  {/* Кнопка загрузки — пока чек не отправлен */}
                  {!sentAt && (
                    <div className="row gap" style={{ marginTop: 12, flexWrap: "wrap" }}>
                      <input
                        ref={(el) => { fileInputs.current[b.id] = el; }}
                        type="file"
                        accept=".pdf,image/jpeg,image/png,image/webp"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadAndSend(b, f);
                          e.target.value = "";
                        }}
                      />
                      <button
                        className="primary"
                        onClick={() => onPick(b)}
                        disabled={isBusy}
                      >
                        {isBusy && <Spinner />}
                        {isBusy
                          ? "Сохраняем..."
                          : (fileUploaded ? "📎 Заменить файл" : "📎 Загрузить и сохранить")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
