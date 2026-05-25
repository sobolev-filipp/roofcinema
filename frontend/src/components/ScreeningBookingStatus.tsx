import { useEffect, useState } from "react";
import { api, ApiError, type Screening, type ScreeningNotifySubscription } from "../api";
import { useAuth } from "../auth";
import { useNavigate } from "react-router-dom";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

export type BookingWindowStatus = "open" | "not_yet_open" | "closed" | "past";

export function getBookingStatus(s: Screening, now: Date = new Date()): BookingWindowStatus {
  const starts = new Date(s.starts_at);
  if (now >= starts) return "past";
  if (s.booking_opens_at && now < new Date(s.booking_opens_at)) return "not_yet_open";
  const closeAt = s.booking_closes_at ? new Date(s.booking_closes_at) : starts;
  if (now >= closeAt) return "closed";
  return "open";
}

type Props = {
  screening: Screening;
  status: BookingWindowStatus;
};

/** Баннер для статусов кроме "open": показывает причину и (для not_yet_open) кнопку подписки. */
export default function ScreeningBookingStatus({ screening, status }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sub, setSub] = useState<ScreeningNotifySubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedSub, setLoadedSub] = useState(false);

  useEffect(() => {
    if (status !== "not_yet_open" || !user) {
      setSub(null);
      setLoadedSub(true);
      return;
    }
    setLoadedSub(false);
    api.get<ScreeningNotifySubscription | null>(`/api/screenings/${screening.id}/notify/me`)
      .then((s) => { setSub(s); })
      .catch(() => { setSub(null); })
      .finally(() => setLoadedSub(true));
  }, [screening.id, status, user]);

  async function subscribe() {
    if (!user) {
      nav(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(true); setErr(null);
    try {
      const s = await api.post<ScreeningNotifySubscription>(`/api/screenings/${screening.id}/notify`);
      setSub(s);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) {
        setErr("Вы уже получили уведомление о старте");
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true); setErr(null);
    try {
      await api.del(`/api/screenings/${screening.id}/notify`);
      setSub(null);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (status === "past") {
    return (
      <div className="hint-box muted" style={{ marginTop: 12, fontSize: 13 }}>
        Этот показ уже состоялся.
      </div>
    );
  }
  if (status === "closed") {
    return (
      <div className="hint-box" style={{ marginTop: 12 }}>
        Бронирование на этот показ закрыто
        {screening.booking_closes_at && ` (закрылось ${fmt(screening.booking_closes_at)})`}.
      </div>
    );
  }
  if (status === "not_yet_open") {
    const opens = screening.booking_opens_at!;
    const isSubscribed = sub && !sub.notified_at;
    return (
      <div className="hint-box" style={{ marginTop: 12 }}>
        <div>
          Бронирование откроется <b>{fmt(opens)}</b>.
        </div>
        <div className="row gap" style={{ marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!loadedSub ? (
            <span className="muted" style={{ fontSize: 12 }}>...</span>
          ) : isSubscribed ? (
            <>
              <span className="badge accent">Подписка активна</span>
              <span className="muted" style={{ fontSize: 12 }}>письмо придёт на {sub!.email}</span>
              <button type="button" className="ghost" onClick={unsubscribe} disabled={busy}>
                Отписаться
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={subscribe} disabled={busy}>
              {user ? "Уведомить о старте брони" : "Войти и подписаться на старт"}
            </button>
          )}
        </div>
        {err && <div className="error" style={{ marginTop: 6 }}>{err}</div>}
      </div>
    );
  }
  return null;
}
