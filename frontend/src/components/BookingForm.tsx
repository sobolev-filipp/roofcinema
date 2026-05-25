import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Booking, type Screening } from "../api";
import { useAuth } from "../auth";

type Qty = Record<number, number>;  // sst.id -> qty

type Props = {
  screening: Screening;
  onCancel: () => void;
};

export default function BookingForm({ screening, onCancel }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [qty, setQty] = useState<Qty>({});
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [social, setSocial] = useState(user?.social_url ?? "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = useMemo(() => {
    return screening.seats.reduce((sum, sst) => sum + (qty[sst.id] ?? 0) * Number(sst.price), 0);
  }, [qty, screening]);
  const totalSeats = useMemo(() => Object.values(qty).reduce((a, b) => a + b, 0), [qty]);

  function setSeat(sstId: number, value: number) {
    setQty((q) => ({ ...q, [sstId]: Math.max(0, value) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      nav(`/login?next=${encodeURIComponent(`/movies/${screening.movie_id}`)}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const items = screening.seats
        .map((sst) => ({ screening_seat_type_id: sst.id, qty: qty[sst.id] ?? 0 }))
        .filter((it) => it.qty > 0);
      if (items.length === 0) {
        throw new Error("Выберите хотя бы одно место");
      }
      const b = await api.post<Booking>("/api/bookings", {
        screening_id: screening.id,
        items,
        full_name: fullName,
        email,
        phone: phone || null,
        social_url: social || null,
        pd_consent: consent,
      });
      nav(`/bookings/${b.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="booking-form">
      {err && <div className="error">{err}</div>}

      <h4 style={{ marginTop: 0 }}>Выберите места</h4>
      <div className="seat-list">
        {screening.seats.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>Для этого показа места не настроены.</div>
        )}
        {screening.seats.map((sst) => {
          const q = qty[sst.id] ?? 0;
          return (
            <div key={sst.id} className="seat-row">
              <div className="seat-info">
                <div className="seat-name">{sst.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{Number(sst.price).toFixed(0)} ₽ × до {sst.count}</div>
              </div>
              <div className="qty-controls">
                <button type="button" onClick={() => setSeat(sst.id, q - 1)} disabled={q <= 0}>−</button>
                <span className="qty-value">{q}</span>
                <button type="button" onClick={() => setSeat(sst.id, q + 1)} disabled={q >= sst.count}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      {totalSeats > 0 && (
        <div className="booking-total">
          <span>{totalSeats} {totalSeats === 1 ? "место" : totalSeats < 5 ? "места" : "мест"}</span>
          <span className="total-amount">{total.toFixed(0)} ₽</span>
        </div>
      )}

      {user ? (
        <>
          <div className="row gap" style={{ flexWrap: "wrap", marginTop: 12 }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>ФИО</label>
              <input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="row gap" style={{ flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>Телефон (необязательно)</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>Соцсеть (необязательно)</label>
              <input placeholder="https://t.me/..." value={social} onChange={(e) => setSocial(e.target.value)} />
            </div>
          </div>
          <label className="checkbox" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Согласен на обработку персональных данных согласно 152-ФЗ
              и принимаю <a href="#">Условия бронирования</a>.
            </span>
          </label>

          <div className="row gap" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button type="button" className="ghost" onClick={onCancel}>Отмена</button>
            <button type="submit" className="primary" disabled={busy || totalSeats === 0 || !consent}>
              {busy ? "Бронируем..." : `Забронировать на ${total.toFixed(0)} ₽`}
            </button>
          </div>
        </>
      ) : (
        <div className="hint-box auth-cta">
          <div style={{ marginBottom: 12 }}>
            Чтобы забронировать, войдите или зарегистрируйтесь — после этого вы автоматически вернётесь сюда.
          </div>
          <div className="row gap" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary"
              onClick={() => nav(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
            >
              Войти
            </button>
            <button
              type="button"
              onClick={() => nav(`/register?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
            >
              Регистрация
            </button>
            <button type="button" className="ghost" onClick={onCancel}>Отмена</button>
          </div>
        </div>
      )}
    </form>
  );
}
