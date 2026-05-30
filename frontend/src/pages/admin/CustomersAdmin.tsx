import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Booking, type Screening, type UserSearchHit } from "../../api";
import { useAuth } from "../../auth";
import { Skeleton, Spinner } from "../../components/Loaders";
import { STATUS_COLOR, STATUS_LABELS } from "../../lib/bookingStatus";
import { useDebouncedValue } from "../../lib/hooks";
import { useUI } from "../../ui";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

const ACTIVE = new Set(["waiting_payment", "paid", "paid_by_balance", "attended"]);
const PAID = new Set(["paid", "paid_by_balance", "attended"]);

function isActiveScreening(s: Screening) {
  return s.is_active && !s.cancelled_at && new Date(s.starts_at).getTime() > Date.now();
}

export default function CustomersAdmin() {
  const { confirm, notify } = useUI();
  const { hasPerm } = useAuth();
  const [query, setQuery] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const debounced = useDebouncedValue(query, 300);
  const [hits, setHits] = useState<UserSearchHit[]>([]);
  const [selected, setSelected] = useState<{ email: string; name: string; balance: number } | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [transferFor, setTransferFor] = useState<{ b: Booking; target: number | null } | null>(null);

  useEffect(() => {
    api.get<Screening[]>("/api/screenings?include_inactive=true").then(setScreenings).catch(() => {});
  }, []);

  // поиск
  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) { setHits([]); return; }
    api.get<UserSearchHit[]>(`/api/admin/users/search?q=${encodeURIComponent(q)}`)
      .then(setHits).catch(() => setHits([]));
  }, [debounced]);

  async function openCustomer(h: UserSearchHit) {
    if (!h.email) return;
    setSelected({ email: h.email, name: h.full_name || h.email, balance: h.balance || 0 });
    setHits([]);
    setQuery("");
    await loadBookings(h.email);
  }

  async function loadBookings(email: string) {
    setLoading(true);
    try {
      const list = await api.get<Booking[]>(`/api/admin/bookings/by-email?email=${encodeURIComponent(email)}`);
      setBookings(list);
      // обновим баланс
      try {
        const r = await api.get<{ balance: number }>(`/api/admin/email-balance?email=${encodeURIComponent(email)}`);
        setSelected((s) => s ? { ...s, balance: r.balance || 0 } : s);
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  }

  const transferTargets = useMemo(() => screenings.filter(isActiveScreening), [screenings]);

  async function refundToBalance(b: Booking) {
    const ok = await confirm({
      title: "Вернуть на баланс?",
      message: `${Number(b.total_amount).toFixed(0)} ₽ зачислятся на баланс ${b.email}. Бронь станет «возвращённой».`,
      confirmText: "Вернуть на баланс",
    });
    if (!ok) return;
    setBusyId(b.id);
    try {
      await api.post(`/api/bookings/${b.id}/refund-to-balance`);
      if (selected) await loadBookings(selected.email);
    } catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
    finally { setBusyId(null); }
  }

  async function cancelBooking(b: Booking) {
    const wasPaid = PAID.has(b.status);
    const ok = await confirm({
      title: "Отменить бронь?",
      message: wasPaid
        ? `${b.full_name}. Бронь оплачена — будет создан запрос на возврат денег (пользователь введёт реквизиты). Если хотите вернуть на баланс — используйте «→ на баланс».`
        : `${b.full_name}. Бронь будет отменена, места освободятся.`,
      confirmText: "Отменить бронь",
      danger: true,
    });
    if (!ok) return;
    setBusyId(b.id);
    try {
      await api.post(`/api/bookings/${b.id}/cancel`);
      if (selected) await loadBookings(selected.email);
    } catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
    finally { setBusyId(null); }
  }

  async function submitTransfer() {
    if (!transferFor || !transferFor.target) return;
    const { b, target } = transferFor;
    setTransferFor(null);
    setBusyId(b.id);
    try {
      await api.post(`/api/bookings/${b.id}/transfer?target_screening_id=${target}`);
      if (selected) await loadBookings(selected.email);
      await notify({ title: "Перенесено", message: "Бронь перенесена на другой показ.", kind: "success" });
    } catch (e: any) { await notify({ title: "Ошибка переноса", message: e.message, kind: "error" }); }
    finally { setBusyId(null); }
  }

  // Брони на отменённом показе (статус ещё paid/paid_by_balance, но ждут решения
  // в разделе «Отмена показа») не должны выглядеть как обычные активные.
  const activeBookings = bookings.filter((b) => ACTIVE.has(b.status) && !b.needs_cancel_resolution);
  const needsResolution = bookings.filter((b) => ACTIVE.has(b.status) && b.needs_cancel_resolution);
  const otherBookings = bookings.filter((b) => !ACTIVE.has(b.status));

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Клиенты</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Найдите гостя по email / телефону / ФИО — увидите его баланс, брони и сможете
        перенести или отменить их.
      </p>

      <div className="card" style={{ marginTop: 12, position: "relative" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Поиск клиента</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="email@... / +7... / ФИО"
          />
          {hits.length > 0 && (
            <div className="user-hits">
              {hits.map((h, i) => (
                <button key={i} type="button" className="user-hit" onClick={() => openCustomer(h)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <b>{h.full_name || h.email || "—"}</b>
                    <span className="badge accent" style={{ fontSize: 10 }}>
                      {h.source === "user" ? "Аккаунт" : "Из броней"}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {h.email}{h.phone && ` · ${h.phone}`}
                  </div>
                  {h.balance > 0 && (
                    <div style={{ fontSize: 11, marginTop: 2, color: "var(--ok)", fontWeight: 600 }}>
                      баланс: {h.balance.toLocaleString("ru-RU")} ₽
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.name}</div>
                <div className="muted" style={{ fontSize: 13 }}>{selected.email}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted" style={{ fontSize: 12 }}>Баланс</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: selected.balance > 0 ? "var(--ok)" : "var(--text-dim)" }}>
                  {selected.balance.toLocaleString("ru-RU")} ₽
                </div>
                {selected.balance > 0 && hasPerm("manage_refunds") && (
                  <button
                    type="button"
                    className="ghost btn-sm"
                    style={{ marginTop: 8 }}
                    onClick={() => setRefundOpen(true)}
                  >
                    Вернуть средства
                  </button>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ marginTop: 16 }}><Skeleton variant="row" count={3} /></div>
          ) : bookings.length === 0 ? (
            <div className="empty" style={{ marginTop: 16 }}>У этого клиента нет броней.</div>
          ) : (
            <>
              {activeBookings.length > 0 && (
                <>
                  <h3 style={{ marginTop: 20 }}>Активные брони</h3>
                  <div className="cards-grid">
                    {activeBookings.map((b) => (
                      <BookingCard
                        key={b.id} b={b} busy={busyId === b.id}
                        onTransfer={() => setTransferFor({ b, target: null })}
                        onRefundBalance={() => refundToBalance(b)}
                        onCancel={() => cancelBooking(b)}
                      />
                    ))}
                  </div>
                </>
              )}
              {needsResolution.length > 0 && (
                <>
                  <h3 style={{ marginTop: 20 }}>Требуют решения — показ отменён</h3>
                  <div className="cards-grid">
                    {needsResolution.map((b) => (
                      <BookingCard key={b.id} b={b} busy={busyId === b.id} history />
                    ))}
                  </div>
                </>
              )}
              {otherBookings.length > 0 && (
                <>
                  <h3 style={{ marginTop: 20 }}>История</h3>
                  <div className="cards-grid">
                    {otherBookings.map((b) => (
                      <BookingCard key={b.id} b={b} busy={busyId === b.id} history />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {refundOpen && selected && (
        <BalanceRefundModal
          email={selected.email}
          balance={selected.balance}
          onClose={() => setRefundOpen(false)}
          onDone={async () => {
            setRefundOpen(false);
            await loadBookings(selected.email);
            await notify({
              title: "Запрос создан",
              message: "Сумма списана с баланса, запрос появился в разделе «Возвраты».",
              kind: "success",
            });
          }}
        />
      )}

      {transferFor && (
        <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={() => setTransferFor(null)}>
          <div className="ui-dialog" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-dialog-title">Перенести бронь</h3>
            <div className="ui-dialog-body">
              {transferFor.b.full_name} — на какой показ перенести?
            </div>
            <select
              autoFocus
              value={transferFor.target ?? ""}
              onChange={(e) => setTransferFor({ b: transferFor.b, target: e.target.value ? Number(e.target.value) : null })}
              style={{ marginTop: 12, width: "100%" }}
            >
              <option value="">— выбрать показ —</option>
              {transferTargets
                .filter((s) => s.id !== transferFor.b.screening_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.movie.title} · {fmt(s.starts_at)} · {s.rooftop.name}
                  </option>
                ))}
            </select>
            <div className="ui-dialog-actions">
              <button type="button" className="ghost" onClick={() => setTransferFor(null)}>Отмена</button>
              <button type="button" className="primary" onClick={submitTransfer} disabled={!transferFor.target}>
                Перенести
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BookingCard({
  b, busy, history, onTransfer, onRefundBalance, onCancel,
}: {
  b: Booking;
  busy: boolean;
  history?: boolean;
  onTransfer?: () => void;
  onRefundBalance?: () => void;
  onCancel?: () => void;
}) {
  const info = b.screening_info;
  const canTransfer = ["waiting_payment", "paid", "paid_by_balance"].includes(b.status);
  const canRefundBalance = ["paid", "paid_by_balance"].includes(b.status);
  const canCancel = ["waiting_payment", "paid", "paid_by_balance"].includes(b.status);
  const notice = b.needs_cancel_resolution
    ? "Показ отменён — выберите действие (перенос / на баланс / возврат) в разделе «Отмена показа»."
    : b.status === "refund_pending"
      ? "Ожидание возврата средств — реквизиты у пользователя/админа, перевод ещё не выполнен."
      : null;
  return (
    <div className="card">
      <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <Link to={`/bookings/${b.id}`} className="rooftop-link" style={{ fontWeight: 600 }}>
            #{b.id} · {info?.movie_title ?? "—"}
          </Link>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {info ? fmt(info.starts_at) : ""}{info?.rooftop_name ? ` · ${info.rooftop_name}` : ""}
          </div>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            {b.items.map((it) => <span key={it.id} style={{ marginRight: 8 }}>{it.name} ×{it.qty}</span>)}
          </div>
          <div style={{ marginTop: 4, fontWeight: 600 }}>
            {Number(b.total_amount).toFixed(0)} ₽
            {Number(b.balance_used) > 0 && (
              <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                (с баланса: {Number(b.balance_used).toFixed(0)})
              </span>
            )}
          </div>
        </div>
        <span className="status-pill" style={{ color: STATUS_COLOR[b.status] }}>
          {STATUS_LABELS[b.status]}
        </span>
      </div>

      {notice && (
        <div className="hint-box" style={{ marginTop: 10, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {!history && (
        <div className="row gap" style={{ marginTop: 12, flexWrap: "wrap", gap: 12 }}>
          {canTransfer && <button onClick={onTransfer} disabled={busy}>Перенести</button>}
          {canRefundBalance && (
            <button onClick={onRefundBalance} disabled={busy}>
              {busy && <Spinner />}→ на баланс
            </button>
          )}
          {canCancel && (
            <button className="ghost danger-on-hover" onClick={onCancel} disabled={busy}>
              Отменить
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BalanceRefundModal({
  email, balance, onClose, onDone,
}: {
  email: string;
  balance: number;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { notify } = useUI();
  const [amount, setAmount] = useState<string>(String(Math.round(balance)));
  const [fullName, setFullName] = useState("");
  const [card, setCard] = useState("");
  const [bank, setBank] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      await notify({ title: "Проверьте сумму", message: "Введите сумму больше нуля.", kind: "error" });
      return;
    }
    if (amt > balance + 1e-6) {
      await notify({ title: "Слишком большая сумма", message: `На балансе только ${balance.toFixed(0)} ₽.`, kind: "error" });
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/admin/balance-refund-request", {
        email,
        amount: amt,
        payout_full_name: fullName.trim() || null,
        payout_card_or_sbp: card.trim() || null,
        payout_bank: bank.trim() || null,
        payout_comment: comment.trim() || null,
      });
      await onDone();
    } catch (e: any) {
      await notify({ title: "Ошибка", message: e.message, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ui-dialog" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="ui-dialog-title">Вернуть средства с баланса</h3>
        <div className="ui-dialog-body">
          Баланс {email}: <b>{balance.toFixed(0)} ₽</b>. Укажите сумму к возврату — она сразу
          спишется с баланса, а запрос появится в разделе «Возвраты». Реквизиты можно ввести
          здесь или позже в «Возвратах».
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Сумма к возврату, ₽ *</label>
            <input
              type="number"
              min={1}
              max={Math.round(balance)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>ФИО получателя</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иванов Иван Иванович" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Карта или телефон СБП</label>
            <input value={card} onChange={(e) => setCard(e.target.value)} placeholder="2200 1234 5678 9012 или +7 999..." />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Банк</label>
            <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Сбербанк, Тинькофф..." />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Комментарий</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: переводить на СБП" />
          </div>
        </div>
        <div className="ui-dialog-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="primary" onClick={submit} disabled={busy}>
            {busy && <Spinner />}Создать возврат
          </button>
        </div>
      </div>
    </div>
  );
}
