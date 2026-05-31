import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Booking } from "../api";
import { STATUS_COLOR, STATUS_LABELS } from "../lib/bookingStatus";
import { Spinner } from "./Loaders";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

/** Админ-карточка с контактами клиента, его балансом и историей всех броней
 *  (по email). Показывается на странице брони, когда админ смотрит чужую бронь. */
export default function AdminCustomerBox({ booking }: { booking: Booking }) {
  const [history, setHistory] = useState<Booking[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const email = booking.email;
    setLoading(true);
    Promise.all([
      api.get<Booking[]>(`/api/admin/bookings/by-email?email=${encodeURIComponent(email)}`).catch(() => []),
      api.get<{ balance: number }>(`/api/admin/email-balance?email=${encodeURIComponent(email)}`).catch(() => ({ balance: 0 })),
    ]).then(([list, bal]) => {
      if (!alive) return;
      setHistory(list);
      setBalance(bal.balance ?? 0);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [booking.email]);

  const others = (history ?? []).filter((b) => b.id !== booking.id);

  return (
    <div className="card admin-tpl-box" style={{ marginTop: 12, borderColor: "var(--accent)" }}>
      <h3 style={{ marginTop: 0 }}>👤 Админ: клиент</h3>

      <div style={{ fontSize: 14 }}>
        <div style={{ fontWeight: 600 }}>{booking.full_name}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          <a href={`mailto:${booking.email}`} className="rooftop-link">{booking.email}</a>
          {booking.phone && (
            <> · <a href={`tel:${booking.phone}`} className="rooftop-link">{booking.phone}</a></>
          )}
        </div>
        {booking.social_url && (
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            <a href={booking.social_url} target="_blank" rel="noopener" className="rooftop-link">
              {booking.social_url}
            </a>
          </div>
        )}
        {balance !== null && balance > 0 && (
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--ok)", fontWeight: 600 }}>
            Баланс: {balance.toLocaleString("ru-RU")} ₽
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          История броней{loading ? "" : ` (${others.length})`}
        </div>
        {loading ? (
          <Spinner />
        ) : others.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>Других броней нет.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {others.map((b) => (
              <Link
                key={b.id}
                to={`/bookings/${b.id}`}
                className="card"
                style={{ padding: "8px 10px", display: "block" }}
              >
                <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    #{b.id} · {b.screening_info?.movie_title ?? "—"}
                  </span>
                  <span className="status-pill" style={{ fontSize: 11, color: STATUS_COLOR[b.status] }}>
                    {STATUS_LABELS[b.status]}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {b.screening_info ? fmt(b.screening_info.starts_at) : ""}
                  {b.screening_info?.rooftop_name ? ` · ${b.screening_info.rooftop_name}` : ""}
                  {" · "}{Number(b.total_amount).toFixed(0)} ₽
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
