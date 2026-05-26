import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Booking, type Screening } from "../../api";
import { STATUS_COLOR, STATUS_LABELS, formatCountdown, msUntil } from "../../lib/bookingStatus";
import { useBookingsWs } from "../../lib/useBookingsWs";
import { useUI } from "../../ui";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

const ACTIVE_STATUSES = new Set(["waiting_payment", "paid", "paid_by_balance"]);
type Tab = "active" | "completed";

function isActiveScreening(s: Screening) {
  return s.is_active && new Date(s.starts_at).getTime() > Date.now();
}

export default function BookingsAdmin() {
  const { confirm, notify } = useUI();
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [tab, setTab] = useState<Tab>("active");
  const [screeningId, setScreeningId] = useState<number | null>(null);
  const [screeningSearch, setScreeningSearch] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  // Полный список (до фильтрации по вкладке) — нужен для подсчёта статистики
  // (остаток мест + сумма выручки), которая не должна зависеть от выбранной вкладки.
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    api.get<Screening[]>("/api/screenings?include_inactive=true").then(setScreenings);
  }, []);

  // показы для текущей вкладки
  const screeningsForTab = useMemo(() => {
    const list = tab === "active" ? screenings.filter(isActiveScreening) : screenings.filter((s) => !isActiveScreening(s));
    const needle = screeningSearch.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((s) =>
      s.movie.title.toLowerCase().includes(needle) ||
      s.rooftop.name.toLowerCase().includes(needle) ||
      fmt(s.starts_at).toLowerCase().includes(needle)
    );
  }, [screenings, tab, screeningSearch]);

  // если текущий показ не в списке текущей вкладки — сбросим
  useEffect(() => {
    if (screeningId === null) return;
    if (!screeningsForTab.find((s) => s.id === screeningId)) setScreeningId(null);
  }, [screeningsForTab, screeningId]);

  async function reload() {
    if (!screeningId) { setBookings([]); setAllBookings([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ screening_id: String(screeningId) });
      if (q.trim()) params.set("q", q.trim());
      const bs = await api.get<Booking[]>(`/api/bookings?${params.toString()}`);
      setAllBookings(bs);
      const filtered = bs.filter((b) =>
        tab === "active" ? ACTIVE_STATUSES.has(b.status) : !ACTIVE_STATUSES.has(b.status)
      );
      setBookings(filtered);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, [screeningId, tab]); // eslint-disable-line

  useBookingsWs(screeningId, reload);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  const selectedScreening = useMemo(() => screenings.find((s) => s.id === screeningId) ?? null, [screenings, screeningId]);

  // Статистика по выбранному показу — занятость мест и оплаченная выручка.
  // Считается из allBookings, поэтому не зависит от выбранной вкладки.
  const SEAT_HOLDING_STATUSES = new Set(["waiting_payment", "paid", "paid_by_balance", "attended"]);
  const PAID_STATUSES = new Set(["paid", "paid_by_balance", "attended"]);
  const screeningStats = useMemo(() => {
    if (!selectedScreening) return null;
    // По каждому типу мест: сколько забронировано (в активных/оплаченных бронях)
    const seatStats = selectedScreening.seats.map((sst) => {
      const taken = allBookings
        .filter((b) => SEAT_HOLDING_STATUSES.has(b.status))
        .flatMap((b) => b.items)
        .filter((it) => it.screening_seat_type_id === sst.id)
        .reduce((sum, it) => sum + Number(it.qty), 0);
      const total = Number(sst.count);
      return {
        id: sst.id,
        name: sst.name,
        total,
        taken,
        available: Math.max(0, total - taken),
        price: Number(sst.price),
      };
    });
    // Выручка — сумма total_amount по оплаченным/посещённым броням
    const paidBookings = allBookings.filter((b) => PAID_STATUSES.has(b.status));
    const revenue = paidBookings.reduce((sum, b) => sum + Number(b.total_amount), 0);
    const paidCount = paidBookings.length;
    return { seatStats, revenue, paidCount };
  }, [selectedScreening, allBookings]); // eslint-disable-line

  const [extendModal, setExtendModal] = useState<{ b: Booking; minutes: number } | null>(null);
  const [transferModal, setTransferModal] = useState<{ b: Booking; target: number | null } | null>(null);

  async function extend(b: Booking) {
    setExtendModal({ b, minutes: 60 });
  }
  async function submitExtend() {
    if (!extendModal) return;
    const { b, minutes } = extendModal;
    if (!minutes || minutes < 1) return;
    setExtendModal(null);
    try { await api.post(`/api/bookings/${b.id}/extend?minutes=${minutes}`); await reload(); }
    catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }
  async function adminCancel(b: Booking) {
    const ok = await confirm({
      title: "Отменить бронь?",
      message: `${b.full_name}. Деньги пользователю не возвращаются автоматически — это делается отдельно.`,
      confirmText: "Отменить бронь",
      danger: true,
    });
    if (!ok) return;
    try { await api.post(`/api/bookings/${b.id}/cancel`); await reload(); }
    catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }
  async function refundToBalance(b: Booking) {
    const ok = await confirm({
      title: "Вернуть на баланс?",
      message: `${Number(b.total_amount).toFixed(0)} ₽ зачислится на баланс «${b.full_name}». Бронь станет «возвращённой».`,
      confirmText: "Вернуть на баланс",
    });
    if (!ok) return;
    try { await api.post(`/api/bookings/${b.id}/refund-to-balance`); await reload(); }
    catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }

  async function requestMoneyRefund(b: Booking) {
    const ok = await confirm({
      title: "Запросить возврат денег?",
      message: `Пользователю ${b.full_name} (${b.email}) уйдёт письмо со ссылкой на форму ввода реквизитов. После заполнения возврат появится в разделе «Возвраты».`,
      confirmText: "Создать запрос",
    });
    if (!ok) return;
    try {
      await api.post(`/api/admin/bookings/${b.id}/refund-request`);
      await reload();
      await notify({ title: "Готово", message: "Запрос создан, ссылка отправлена на email пользователя.", kind: "success" });
    } catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }
  async function transferBooking(b: Booking) {
    setTransferModal({ b, target: null });
  }
  async function submitTransfer() {
    if (!transferModal || !transferModal.target) return;
    const { b, target } = transferModal;
    setTransferModal(null);
    try { await api.post(`/api/bookings/${b.id}/transfer?target_screening_id=${target}`); await reload(); }
    catch (e: any) { await notify({ title: "Ошибка переноса", message: e.message, kind: "error" }); }
  }
  async function markPaid(b: Booking) {
    const ok = await confirm({
      title: "Пометить оплаченной?",
      message: `Ручное подтверждение для ${b.full_name} (без проверки чека). Используйте, если оплата подтверждена другим способом.`,
      confirmText: "Пометить оплаченной",
    });
    if (!ok) return;
    try { await api.post(`/api/bookings/${b.id}/mark-paid`); await reload(); }
    catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Бронирования</h2>

      <div className="seg" style={{ marginTop: 12, marginBottom: 16 }}>
        <button type="button" className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>
          Актуальные
        </button>
        <button type="button" className={tab === "completed" ? "active" : ""} onClick={() => setTab("completed")}>
          Завершённые
        </button>
      </div>

      <div className="card">
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Поиск показа (по фильму, крыше или дате)</label>
          <input
            value={screeningSearch}
            onChange={(e) => setScreeningSearch(e.target.value)}
            placeholder="Например: Бойцовский, Лофт, 23 мая"
          />
        </div>

        {screeningsForTab.length === 0 ? (
          <div className="empty">
            {tab === "active" ? "Нет активных показов." : "Завершённых показов нет."}
          </div>
        ) : (
          <div className="screening-picker">
            {screeningsForTab.slice(0, 20).map((s) => (
              <button
                key={s.id}
                type="button"
                className={"screening-picker-item" + (s.id === screeningId ? " active" : "")}
                onClick={() => setScreeningId(s.id)}
              >
                <div className="sp-title">{s.movie.title}</div>
                <div className="sp-meta">{fmt(s.starts_at)} · {s.rooftop.name}</div>
              </button>
            ))}
            {screeningsForTab.length > 20 && (
              <div className="muted" style={{ fontSize: 12, padding: "var(--s-2)" }}>
                Показано 20 из {screeningsForTab.length}. Уточните поиск.
              </div>
            )}
          </div>
        )}
      </div>

      {extendModal && (
        <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={() => setExtendModal(null)}>
          <div className="ui-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-dialog-title">Продлить бронь</h3>
            <div className="ui-dialog-body">
              {extendModal.b.full_name} — на сколько минут добавить времени для оплаты?
            </div>
            <input
              autoFocus
              type="number"
              min={1}
              max={10080}
              value={extendModal.minutes}
              onChange={(e) => setExtendModal({ b: extendModal.b, minutes: Number(e.target.value) })}
              style={{ marginTop: 12, width: "100%" }}
            />
            <div className="ui-dialog-actions">
              <button type="button" className="ghost" onClick={() => setExtendModal(null)}>Отмена</button>
              <button type="button" className="primary" onClick={submitExtend}>Продлить</button>
            </div>
          </div>
        </div>
      )}

      {transferModal && (
        <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={() => setTransferModal(null)}>
          <div className="ui-dialog" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-dialog-title">Перенести бронь</h3>
            <div className="ui-dialog-body">
              {transferModal.b.full_name} — на какой показ перенести?
              Перенос сохранит типы мест по именам и не меняет уплаченную цену.
            </div>
            <select
              autoFocus
              value={transferModal.target ?? ""}
              onChange={(e) => setTransferModal({ b: transferModal.b, target: e.target.value ? Number(e.target.value) : null })}
              style={{ marginTop: 12, width: "100%" }}
            >
              <option value="">— выбрать показ —</option>
              {screenings
                .filter((s) => s.id !== transferModal.b.screening_id && isActiveScreening(s))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.movie.title} · {fmt(s.starts_at)} · {s.rooftop.name}
                  </option>
                ))}
            </select>
            <div className="ui-dialog-actions">
              <button type="button" className="ghost" onClick={() => setTransferModal(null)}>Отмена</button>
              <button type="button" className="primary" onClick={submitTransfer} disabled={!transferModal.target}>
                Перенести
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedScreening && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
            <h3 style={{ margin: 0 }}>
              {selectedScreening.movie.title}
              <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 14 }}>
                · {fmt(selectedScreening.starts_at)} · {selectedScreening.rooftop.name}
              </span>
            </h3>
            <span className="muted" style={{ fontSize: 12 }}>обновляется в реальном времени</span>
          </div>

          {/* Статистика показа: занятость мест + выручка */}
          {screeningStats && (
            <div className="screening-stats" style={{ marginTop: 14 }}>
              <div className="screening-stats-seats">
                {screeningStats.seatStats.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13 }}>У показа не настроены типы мест.</div>
                ) : (
                  screeningStats.seatStats.map((s) => {
                    const pct = s.total > 0 ? Math.round((s.taken / s.total) * 100) : 0;
                    const isFull = s.available === 0 && s.total > 0;
                    return (
                      <div key={s.id} className={"stat-seat" + (isFull ? " stat-seat-full" : "")}>
                        <div className="stat-seat-name">{s.name}</div>
                        <div className="stat-seat-counts">
                          <b>{s.available}</b>
                          <span className="muted"> / {s.total}</span>
                        </div>
                        <div className="stat-seat-bar">
                          <div className="stat-seat-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="stat-seat-meta muted">
                          {isFull ? "мест нет" : `занято ${s.taken} из ${s.total}`}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="screening-stats-revenue">
                <div className="stat-revenue-label muted">Оплачено</div>
                <div className="stat-revenue-value">
                  {screeningStats.revenue.toLocaleString("ru-RU")} ₽
                </div>
                <div className="stat-revenue-meta muted">
                  {screeningStats.paidCount === 0
                    ? "нет оплаченных броней"
                    : `${screeningStats.paidCount} ${
                        screeningStats.paidCount === 1 ? "бронь" :
                        screeningStats.paidCount < 5 ? "брони" : "броней"
                      }`}
                </div>
              </div>
            </div>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <label>Поиск по ФИО / email / коду брони</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") reload(); }} />
          </div>

          {loading ? (
            <div className="empty" style={{ marginTop: 12 }}>Загрузка...</div>
          ) : bookings.length === 0 ? (
            <div className="empty" style={{ marginTop: 12 }}>
              {tab === "active" ? "Активных броней нет." : "Завершённых броней нет."}
            </div>
          ) : (
            <div className="admin-bookings-table" style={{ marginTop: 8 }}>
              <div className="abt-header">
                <span>ФИО</span><span>Места</span><span>Сумма</span><span>Статус</span><span>Действия</span>
              </div>
              {bookings.map((b) => {
                const remaining = b.status === "waiting_payment" ? msUntil(b.expires_at) : 0;
                return (
                  <div key={b.id} className="abt-row">
                    <span>
                      <Link to={`/bookings/${b.id}`} className="rooftop-link">{b.full_name}</Link>
                      <div className="muted" style={{ fontSize: 11 }}>{b.email}</div>
                      <div className="muted" style={{ fontSize: 11 }}>код: {b.short_code}</div>
                    </span>
                    <span>
                      {b.items.map((it) => (
                        <div key={it.id}>{it.name} × {it.qty}</div>
                      ))}
                    </span>
                    <span style={{ fontWeight: 600 }}>
                      {Number(b.total_amount).toFixed(0)} ₽
                      {Number(b.balance_used) > 0 && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          с баланса: {Number(b.balance_used).toFixed(0)}
                        </div>
                      )}
                    </span>
                    <span>
                      <span className="status-pill" style={{ borderColor: STATUS_COLOR[b.status], color: STATUS_COLOR[b.status] }}>
                        {STATUS_LABELS[b.status]}
                      </span>
                      {b.status === "waiting_payment" && (
                        <div style={{ fontFamily: "monospace", marginTop: 4 }}>{formatCountdown(remaining)}</div>
                      )}
                    </span>
                    <span className="abt-actions">
                      {b.status === "waiting_payment" && (
                        <>
                          <button onClick={() => extend(b)}>+ время</button>
                          <button onClick={() => markPaid(b)} className="primary">оплачено</button>
                        </>
                      )}
                      {(b.status === "waiting_payment" || b.status === "paid" || b.status === "paid_by_balance") && (
                        <button onClick={() => transferBooking(b)}>перенести</button>
                      )}
                      {(b.status === "paid" || b.status === "paid_by_balance") && (
                        <button onClick={() => refundToBalance(b)}>→ баланс</button>
                      )}
                      {(b.status === "cancelled") && (
                        <>
                          <button onClick={() => refundToBalance(b)}>→ баланс</button>
                          {Number(b.total_amount) - Number(b.balance_used || 0) > 0 && (
                            <button className="primary" onClick={() => requestMoneyRefund(b)}>
                              запросить возврат денег
                            </button>
                          )}
                        </>
                      )}
                      {(b.status === "waiting_payment" || b.status === "paid" || b.status === "paid_by_balance") && (
                        <button className="ghost danger-on-hover" onClick={() => adminCancel(b)}>отменить</button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
