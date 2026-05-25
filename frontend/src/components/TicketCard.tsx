import { useState } from "react";
import type { Booking } from "../api";
import { STATUS_LABELS } from "../lib/bookingStatus";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

const qrUrl = (token: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&qzone=1&color=111111&bgcolor=ffffff&data=${encodeURIComponent(token)}`;

type Props = { booking: Booking };

export default function TicketCard({ booking }: Props) {
  const [open, setOpen] = useState(false);
  const info = booking.screening_info;
  if (!info) return null;

  const totalSeats = booking.items.reduce((sum, it) => sum + it.qty, 0);

  return (
    <div
      className={"ticket-card" + (open ? " open" : "")}
      onClick={() => setOpen((o) => !o)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen((o) => !o); }}
    >
      <div className="ticket-summary">
        <div className="ticket-line ticket-title">{info.movie_title}</div>
        <div className="ticket-line muted-2">{fmtDateTime(info.starts_at)}</div>
        <div className="ticket-line muted-2">
          {info.city_name} · {info.rooftop_name}
        </div>
        {info.rooftop_address ? (
          <div className="ticket-line ticket-address">{info.rooftop_address}</div>
        ) : (
          <div className="ticket-line muted-2" style={{ fontStyle: "italic" }}>Адрес откроется после оплаты</div>
        )}
        <div className="ticket-meta">
          <span className="muted-2">{totalSeats} {totalSeats === 1 ? "место" : totalSeats < 5 ? "места" : "мест"}</span>
          <span className="ticket-status">{STATUS_LABELS[booking.status]}</span>
        </div>
      </div>

      <div className="ticket-expand">
        <div className="ticket-perforation" />
        <div className="ticket-qr">
          <img src={qrUrl(booking.qr_token)} alt="QR-код билета" loading="lazy" />
        </div>
        <div className="ticket-codes">
          <div className="muted-2" style={{ fontSize: 11 }}>Код для ручного входа</div>
          <div className="short-code">{booking.short_code}</div>
        </div>
        <div className="ticket-items">
          {booking.items.map((it) => (
            <div key={it.id} className="ticket-item-row">
              <span>{it.name}</span>
              <span>× {it.qty}</span>
            </div>
          ))}
        </div>
        <div className="muted-2" style={{ fontSize: 11, textAlign: "center" }}>Нажмите, чтобы свернуть</div>
      </div>
    </div>
  );
}
