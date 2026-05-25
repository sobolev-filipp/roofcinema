import { useMemo, useState } from "react";
import { api, type Booking } from "../api";
import { useUI } from "../ui";

type Props = {
  booking: Booking;
  onChange: (b: Booking) => void;
};

function fullClaimUrl(rel: string): string {
  if (!rel) return "";
  if (rel.startsWith("http")) return rel;
  return `${window.location.origin}${rel}`;
}

export default function BookingAttendeesBox({ booking, onChange }: Props) {
  const { confirm, notify } = useUI();
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [guestsCount, setGuestsCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const totalGuests = booking.total_guests || 0;
  const splitGuests = useMemo(
    () => booking.attendees.reduce((s, a) => s + (a.guests_count || 0), 0),
    [booking.attendees],
  );
  const mineGuests = totalGuests - splitGuests;
  const freeSlots = Math.max(0, totalGuests - splitGuests);

  async function addAttendee(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const b = await api.post<Booking>(`/api/bookings/${booking.id}/attendees`, {
        email,
        full_name: fullName || null,
        guests_count: guestsCount,
      });
      onChange(b);
      setEmail(""); setFullName(""); setGuestsCount(1); setShowForm(false);
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  async function remove(attendeeId: number) {
    const ok = await confirm({
      title: "Убрать гостя?",
      message: "Его ссылка-бронь перестанет работать. Места не освобождаются — просто исчезает один гость.",
      confirmText: "Убрать",
      danger: true,
    });
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const b = await api.del<Booking>(`/api/bookings/${booking.id}/attendees/${attendeeId}`);
      onChange(b);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function resend(attendeeId: number) {
    setBusy(true); setErr(null);
    try {
      await api.post(`/api/bookings/${booking.id}/attendees/${attendeeId}/resend`);
      await notify({ title: "Готово", message: "Письмо отправлено повторно.", kind: "success" });
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function copyLink(attendeeId: number, claimUrl: string) {
    const abs = fullClaimUrl(claimUrl);
    navigator.clipboard.writeText(abs).then(
      () => { setCopied(attendeeId); setTimeout(() => setCopied(null), 1500); },
      () => { setErr("Не удалось скопировать ссылку"); },
    );
  }

  if (booking.status === "cancelled" || booking.status === "expired" || booking.status === "refunded") {
    return null;
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>
          Гости брони
          <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
            всего {totalGuests} · вы {mineGuests} · разделено {splitGuests}
          </span>
        </h3>
        {freeSlots > 0 && !showForm && (
          <button className="primary" onClick={() => setShowForm(true)}>+ Разделить с гостем</button>
        )}
      </div>

      {freeSlots === 0 && booking.attendees.length === 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          В этой брони всего один гость — делить нечего.
        </p>
      )}

      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}

      {showForm && (
        <form onSubmit={addAttendee} className="hint-box" style={{ marginTop: 10 }}>
          <div className="row gap" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
              <label>Email гостя</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
              <label>Имя (необязательно)</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="field" style={{ width: 130, marginBottom: 0 }}>
              <label title="Сколько человек придёт по этой части брони">Гостей</label>
              <input
                type="number"
                min={1}
                max={freeSlots}
                value={guestsCount}
                onChange={(e) => setGuestsCount(Math.max(1, Math.min(freeSlots, Number(e.target.value))))}
              />
            </div>
            <div className="row gap">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "..." : "Отправить"}
              </button>
              <button type="button" className="ghost" onClick={() => setShowForm(false)} disabled={busy}>
                Отмена
              </button>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Гостю на email уйдёт ссылка с его кодом и QR. По ссылке он сможет посмотреть свою бронь
            и при желании привязать её к своему аккаунту. Платите всё равно вы.
          </p>
        </form>
      )}

      {booking.attendees.length > 0 && (
        <div className="attendees-list" style={{ marginTop: 12 }}>
          {booking.attendees.map((a) => {
            const abs = fullClaimUrl(a.claim_url);
            return (
              <div key={a.id} className="attendee-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {a.full_name ? `${a.full_name} · ${a.email}` : a.email}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Гостей: {a.guests_count} · код {a.short_code}
                    {a.claimed_at && " · привязано к аккаунту"}
                    {!a.notified_at && " · письмо не отправлено"}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <input
                      readOnly
                      value={abs}
                      onFocus={(e) => e.currentTarget.select()}
                      style={{ flex: 1, minWidth: 220, fontSize: 11 }}
                    />
                    <button type="button" className="ghost" onClick={() => copyLink(a.id, a.claim_url)}>
                      {copied === a.id ? "Скопировано ✓" : "Скопировать"}
                    </button>
                  </div>
                </div>
                <div className="row gap" style={{ flexShrink: 0 }}>
                  <button type="button" className="ghost" onClick={() => resend(a.id)} disabled={busy}>
                    ↻ Письмо
                  </button>
                  <button type="button" className="ghost danger-on-hover" onClick={() => remove(a.id)} disabled={busy}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
