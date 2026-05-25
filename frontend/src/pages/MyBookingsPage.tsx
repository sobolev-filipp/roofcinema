import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Booking } from "../api";
import { STATUS_COLOR, STATUS_LABELS, formatCountdown, msUntil } from "../lib/bookingStatus";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [, force] = useState(0);

  useEffect(() => {
    api.get<Booking[]>("/api/bookings/me").then(setBookings).finally(() => setLoading(false));
  }, []);

  // обновляем UI каждую секунду, чтобы таймеры тикали
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const waitingPayment = bookings.filter((b) => b.status === "waiting_payment");
  const others = bookings.filter((b) => b.status !== "waiting_payment");

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <h1>Мои бронирования</h1>

      {loading && <div className="empty">Загрузка...</div>}

      {waitingPayment.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Ждут оплаты</h2>
          <div className="bookings-list">
            {waitingPayment.map((b) => <BookingRow key={b.id} b={b} />)}
          </div>
        </>
      )}

      {others.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>История</h2>
          <div className="bookings-list">
            {others.map((b) => <BookingRow key={b.id} b={b} />)}
          </div>
        </>
      )}

      {!loading && bookings.length === 0 && (
        <div className="empty">У вас пока нет бронирований. <Link to="/" className="rooftop-link">Перейти к афише</Link></div>
      )}
    </div>
  );
}

function BookingRow({ b }: { b: Booking }) {
  const info = b.screening_info;
  const remainingMs = msUntil(b.expires_at);
  const isWaiting = b.status === "waiting_payment";

  return (
    <Link to={`/bookings/${b.id}`} className="card booking-row">
      <div className="row between" style={{ gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: 1 }}>
          {info?.movie_poster_url ? (
            <img src={info.movie_poster_url} alt="" style={{ width: 54, height: 80, objectFit: "cover", borderRadius: 6 }} />
          ) : (
            <div style={{ width: 54, height: 80, background: "var(--bg-soft)", borderRadius: 6 }} />
          )}
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>{info?.movie_title ?? "—"}</h3>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {info ? fmt(info.starts_at) : ""}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {info?.city_name} · {info?.rooftop_name}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="status-pill" style={{ borderColor: STATUS_COLOR[b.status], color: STATUS_COLOR[b.status] }}>
            {STATUS_LABELS[b.status]}
          </div>
          {isWaiting && (
            <div style={{ marginTop: 8, fontSize: 18, fontFamily: "monospace", fontWeight: 700 }}>
              {formatCountdown(remainingMs)}
            </div>
          )}
          <div style={{ marginTop: 6, fontWeight: 600 }}>{Number(b.total_amount).toFixed(0)} ₽</div>
        </div>
      </div>
    </Link>
  );
}
