import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Booking, type Screening } from "../api";
import { useAuth } from "../auth";
import AdminTemplateCopyBox from "../components/AdminTemplateCopyBox";
import BalancePaymentBox from "../components/BalancePaymentBox";
import BookingAttendeesBox from "../components/BookingAttendeesBox";
import ReceiptUploadBox from "../components/ReceiptUploadBox";
import { STATUS_COLOR, STATUS_LABELS, formatCountdown, msUntil, parseUtc } from "../lib/bookingStatus";
import { useUI } from "../ui";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });
const fmtUtc = (iso: string) =>
  parseUtc(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

export default function BookingPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const { confirm } = useUI();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [screening, setScreening] = useState<Screening | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  async function load() {
    if (!id) return;
    try {
      const b = await api.get<Booking>(`/api/bookings/${id}`);
      setBooking(b);
      // подтянем показ для реквизитов оплаты (только публичная инфа)
      try {
        const s = await api.get<Screening>(`/api/screenings/${b.screening_id}`);
        setScreening(s);
      } catch {}
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (err) return <div className="container"><div className="error">{err}</div></div>;
  if (!booking) return <div className="container"><div className="empty">Загрузка...</div></div>;

  const info = booking.screening_info!;
  const remainingMs = msUntil(booking.expires_at);
  const isWaiting = booking.status === "waiting_payment";
  const isPaid = booking.status === "paid" || booking.status === "paid_by_balance" || booking.status === "attended";
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";
  const pendingReceipt = booking.receipts.find((r) => r.status === "pending") ?? null;
  // Пока чек на проверке — таймер заморожен. После reject backend продлит expires_at
  // на длительность проверки, и отсчёт продолжится с того же значения.
  const isPausedForReceipt = isWaiting && pendingReceipt !== null;

  async function cancel() {
    if (!booking) return;
    const wasPaid = booking.status === "paid" || booking.status === "paid_by_balance";
    const ok = await confirm({
      title: "Отменить бронь?",
      message: wasPaid
        ? "Места освободятся. Так как бронь оплачена, мы автоматически создадим запрос на возврат — вам потребуется ввести реквизиты для перевода."
        : "Места освободятся, бронь будет отменена.",
      confirmText: "Отменить бронь",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const b = await api.post<Booking>(`/api/bookings/${id}/cancel`);
      setBooking(b);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function markPaid() {
    const ok = await confirm({
      title: "Пометить оплаченной?",
      message: "Бронь перейдёт в статус «Оплачено» вручную, без проверки чека.",
      confirmText: "Пометить оплаченной",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const b = await api.post<Booking>(`/api/bookings/${id}/mark-paid`);
      setBooking(b);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function applyBalance(amount: number) {
    setBusy(true);
    try {
      const b = await api.post<Booking>(`/api/bookings/${id}/apply-balance?amount=${amount}`);
      setBooking(b);
      await refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <button className="ghost" onClick={() => nav("/bookings")}>← К моим броням</button>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", minWidth: 0, flex: 1 }}>
            {info.movie_poster_url && (
              <img src={info.movie_poster_url} alt="" style={{ width: 80, height: 120, objectFit: "cover", borderRadius: 6 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>{info.movie_title}</h1>
              <div className="muted" style={{ marginTop: 6 }}>{fmt(info.starts_at)}</div>
              <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                {info.city_name} · <Link to={`/rooftops/${info.rooftop_id}`} className="rooftop-link">{info.rooftop_name}</Link>
              </div>
              {isPausedForReceipt ? (
                <div
                  className="status-pill"
                  style={{ marginTop: 10, borderColor: "#e9b949", color: "#e9b949" }}
                  title="Чек загружен, ждём решения администратора. Таймер брони заморожен."
                >
                  На проверке оплаты
                </div>
              ) : (
                <div
                  className="status-pill"
                  style={{ marginTop: 10, borderColor: STATUS_COLOR[booking.status], color: STATUS_COLOR[booking.status] }}
                >
                  {STATUS_LABELS[booking.status]}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Баннер возврата: показываем когда бронь в статусе refund_pending */}
      {booking.status === "refund_pending" && (
        <div className="card" style={{ marginTop: 12, borderColor: "#f59e0b" }}>
          <h3 style={{ marginTop: 0, color: "#f59e0b" }}>⏳ Ожидается возврат средств</h3>
          {booking.refund_request ? (
            <>
              <p style={{ fontSize: 14, marginTop: 0 }}>
                Бронь отменена. Для получения{" "}
                <b>{Number(booking.refund_request.amount).toFixed(0)} ₽</b> укажите реквизиты для перевода.
              </p>
              {booking.refund_request.status === "completed" ? (
                <div className="hint-box" style={{ borderColor: "#22c55e", background: "rgba(34,197,94,.08)" }}>
                  ✅ Возврат выполнен.
                </div>
              ) : booking.refund_request.status === "filled" ? (
                <div className="hint-box">
                  Реквизиты получены, ждём перевода от организатора.
                </div>
              ) : (
                <a
                  href={`/refund/${booking.refund_request.payout_token}`}
                  className="primary"
                  style={{
                    display: "inline-block", padding: "10px 20px",
                    borderRadius: 8, textDecoration: "none",
                    background: "var(--accent)", color: "#fff", fontWeight: 600,
                  }}
                >
                  Ввести реквизиты для возврата →
                </a>
              )}
              {booking.refund_request.link_sent_at && booking.refund_request.status === "created" && (
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Ссылка также отправлена на {booking.email}
                </div>
              )}
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Запрос на возврат формируется. Ссылка для ввода реквизитов придёт на email.
            </p>
          )}
        </div>
      )}

      {isWaiting && !isPausedForReceipt && (
        <div className="card timer-card">
          <div className="muted" style={{ fontSize: 13 }}>До истечения брони</div>
          <div className="timer-value">{formatCountdown(remainingMs)}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            После {fmtUtc(booking.expires_at)} места освободятся, и бронь нужно будет создать заново.
          </div>
        </div>
      )}
      {isPausedForReceipt && (
        <div className="card timer-card" style={{ borderColor: "#e9b949" }}>
          <div className="muted" style={{ fontSize: 13 }}>Таймер брони на паузе</div>
          <div className="timer-value" style={{ color: "#e9b949" }}>⏸ {formatCountdown(remainingMs)}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Чек ждёт проверки администратора. Если оплата подтвердится — бронь станет оплаченной.
            Если откажут — таймер продолжится с этого же значения.
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Состав брони</h3>
        {booking.items.map((it) => (
          <div key={it.id} className="row between" style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
            <span>{it.name} × {it.qty}</span>
            <span className="muted">{(it.price_each * it.qty).toFixed(0)} ₽</span>
          </div>
        ))}
        <div className="row between" style={{ borderTop: "1px solid var(--border)", padding: "10px 0 0", fontWeight: 700, fontSize: 18 }}>
          <span>Итого</span>
          <span>{Number(booking.total_amount).toFixed(0)} ₽</span>
        </div>
      </div>

      {isWaiting && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Способ оплаты</h3>

          {user && Number(user.balance) > 0 && (
            <BalancePaymentBox
              balance={Number(user.balance)}
              total={Number(booking.total_amount)}
              alreadyUsed={Number(booking.balance_used || 0)}
              busy={busy}
              onApply={applyBalance}
            />
          )}

          {screening?.payout_template ? (
            <div className="payout-details">
              <div className="payment-name" style={{ marginBottom: 8 }}>Перевод по реквизитам</div>
              <div className="payout-grid">
                <span>Получатель:</span>
                <b>{screening.payout_template.recipient_name}</b>
                {screening.payout_template.card_number && (
                  <>
                    <span>Карта:</span>
                    <code className="copy-target">{screening.payout_template.card_number}</code>
                  </>
                )}
                {screening.payout_template.phone && (
                  <>
                    <span>СБП по телефону:</span>
                    <code className="copy-target">{screening.payout_template.phone}</code>
                  </>
                )}
                {screening.payout_template.bank_name && (
                  <>
                    <span>Банк:</span>
                    <span>{screening.payout_template.bank_name}</span>
                  </>
                )}
                <span>Сумма:</span>
                <b>{Number(booking.total_amount).toFixed(0)} ₽</b>
              </div>
              {screening.payout_template.note && (
                <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{screening.payout_template.note}</p>
              )}
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                Сделайте перевод, затем загрузите скриншот чека ниже — администратор подтвердит оплату.
              </p>

              <ReceiptUploadBox booking={booking} onUploaded={setBooking} />
            </div>
          ) : (
            <div className="hint-box">Реквизиты для перевода не настроены организатором показа.</div>
          )}

          <div className="payment-options" style={{ marginTop: 12 }}>
            <button className="payment-option" disabled>
              <div className="payment-name">Карта</div>
              <div className="muted" style={{ fontSize: 12 }}>Скоро</div>
            </button>
            <button className="payment-option" disabled>
              <div className="payment-name">СБП (автоматически)</div>
              <div className="muted" style={{ fontSize: 12 }}>Скоро</div>
            </button>
          </div>

          <div className="row gap" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            {isAdmin && (
              <button className="primary" onClick={markPaid} disabled={busy}>
                [Админ] Пометить оплаченной
              </button>
            )}
            <button className="ghost danger-on-hover" onClick={cancel} disabled={busy}>Отменить бронь</button>
          </div>
        </div>
      )}

      {isPaid && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row between" style={{ flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h3 style={{ margin: 0 }}>Бронь оплачена</h3>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Точный адрес крыши открыт на её странице. Для прохода покажите QR-код или назовите код ниже.
              </div>
            </div>
            <Link to="/profile/tickets" className="btn-as-link primary">Открыть мой QR-код →</Link>
          </div>
          {user && booking.user_id === user.id && booking.status !== "attended" && (
            <div className="row gap" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button className="ghost danger-on-hover" onClick={cancel} disabled={busy}>
                Отменить бронь
              </button>
            </div>
          )}
        </div>
      )}

      {isAdmin && <AdminTemplateCopyBox booking={booking} />}

      {user && booking.user_id === user.id && (
        <BookingAttendeesBox booking={booking} onChange={setBooking} />
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>Код для входа на показ (если QR не сработает):</div>
        <div style={{ fontFamily: "monospace", fontSize: 24, letterSpacing: ".15em", marginTop: 6 }}>{booking.short_code}</div>
      </div>
    </div>
  );
}
