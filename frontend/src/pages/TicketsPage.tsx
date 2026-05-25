import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Booking } from "../api";
import TicketCard from "../components/TicketCard";

const PAID_STATUSES = new Set(["paid", "paid_by_balance", "attended", "no_show"]);

export default function TicketsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "past">("active");

  useEffect(() => {
    api.get<Booking[]>("/api/bookings/me")
      .then((all) => setBookings(all.filter((b) => PAID_STATUSES.has(b.status))))
      .finally(() => setLoading(false));
  }, []);

  const { active, past } = useMemo(() => {
    const now = Date.now();
    const a: Booking[] = [];
    const p: Booking[] = [];
    for (const b of bookings) {
      const startsAt = b.screening_info ? new Date(b.screening_info.starts_at).getTime() : 0;
      if (b.status === "attended" || b.status === "no_show" || startsAt < now) p.push(b);
      else a.push(b);
    }
    // активные — ближайшие сначала; прошлые — недавние сначала
    a.sort((x, y) => (x.screening_info ? new Date(x.screening_info.starts_at).getTime() : 0) - (y.screening_info ? new Date(y.screening_info.starts_at).getTime() : 0));
    p.sort((x, y) => (y.screening_info ? new Date(y.screening_info.starts_at).getTime() : 0) - (x.screening_info ? new Date(x.screening_info.starts_at).getTime() : 0));
    return { active: a, past: p };
  }, [bookings]);

  const list = tab === "active" ? active : past;

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <Link to="/profile" className="ghost btn-as-link" style={{ display: "inline-block" }}>← К профилю</Link>
      <h1 style={{ marginTop: 16 }}>Мои QR-коды</h1>

      <div className="seg" style={{ marginTop: 12 }}>
        <button type="button" className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>
          Действующие {active.length > 0 && <span style={{ opacity: .8 }}>· {active.length}</span>}
        </button>
        <button type="button" className={tab === "past" ? "active" : ""} onClick={() => setTab("past")}>
          Прошедшие {past.length > 0 && <span style={{ opacity: .8 }}>· {past.length}</span>}
        </button>
      </div>

      {loading ? (
        <div className="empty" style={{ marginTop: 16 }}>Загрузка...</div>
      ) : list.length === 0 ? (
        <div className="empty" style={{ marginTop: 16 }}>
          {tab === "active" ? (
            <>Активных броней с QR ещё нет. <Link to="/" className="rooftop-link">Перейти к афише</Link></>
          ) : (
            "Прошедших броней пока нет."
          )}
        </div>
      ) : (
        <div className="tickets-stack">
          {list.map((b) => <TicketCard key={b.id} booking={b} />)}
        </div>
      )}
    </div>
  );
}
