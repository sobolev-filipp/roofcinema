import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Booking, type Screening } from "../../api";
import { STATUS_COLOR, STATUS_LABELS, formatCountdown, msUntil } from "../../lib/bookingStatus";
import { useBookingsWs } from "../../lib/useBookingsWs";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

const ACTIVE_STATUSES = new Set(["waiting_payment", "paid", "paid_by_balance"]);
type Tab = "active" | "completed";

function isActiveScreening(s: Screening) {
  return s.is_active && new Date(s.starts_at).getTime() > Date.now();
}

export default function BookingsAdmin() {
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [tab, setTab] = useState<Tab>("active");
  const [screeningId, setScreeningId] = useState<number | null>(null);
  const [screeningSearch, setScreeningSearch] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
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
    if (!screeningId) { setBookings([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ screening_id: String(screeningId) });
      if (q.trim()) params.set("q", q.trim());
      const bs = await api.get<Booking[]>(`/api/bookings?${params.toString()}`);
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

  async function extend(b: Booking) {
    const minutesStr = window.prompt("На сколько минут продлить?", "60");
    if (!minutesStr) return;
    const m = parseInt(minutesStr, 10);
    if (!m || m < 1) return;
    try { await api.post(`/api/bookings/${b.id}/extend?minutes=${m}`); await reload(); }
    catch (e: any) { alert(e.message); }
  }
  async function adminCancel(b: Booking) {
    if (!window.confirm(`Отменить бронь ${b.full_name}? Деньги пользователю не возвращаются автоматически.`)) return;
    try { await api.post(`/api/bookings/${b.id}/cancel`); await reload(); }
    catch (e: any) { alert(e.message); }
  }
  async function refundToBalance(b: Booking) {
    if (!window.confirm(`Вернуть ${Number(b.total_amount).toFixed(0)} ₽ на баланс «${b.full_name}»?`)) return;
    try { await api.post(`/api/bookings/${b.id}/refund-to-balance`); await reload(); }
    catch (e: any) { alert(e.message); }
  }
  async function transferBooking(b: Booking) {
    const choices = screenings
      .filter((s) => s.id !== b.screening_id && isActiveScreening(s))
      .map((s) => `${s.id} — ${s.movie.title} · ${fmt(s.starts_at)} · ${s.rooftop.name}`)
      .join("\n");
    const targetStr = window.prompt("ID нового показа для переноса:\n\n" + choices, "");
    if (!targetStr) return;
    const target = parseInt(targetStr, 10);
    if (!target) return;
    try { await api.post(`/api/bookings/${b.id}/transfer?target_screening_id=${target}`); await reload(); }
    catch (e: any) { alert(e.message); }
  }
  async function markPaid(b: Booking) {
    if (!window.confirm("Пометить бронь как оплаченную? (заглушка, Фаза 5 заменит на загрузку чека)")) return;
    try { await api.post(`/api/bookings/${b.id}/mark-paid`); await reload(); }
    catch (e: any) { alert(e.message); }
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
                      {b.status === "waiting_payment" && (
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
