import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type ClaimInfo } from "../api";
import { useAuth } from "../auth";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

function qrImageUrl(token: string, size = 240): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(token)}`;
}

export default function ClaimPage() {
  const { token } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token) return;
    setErr(null);
    try {
      const data = await api.get<ClaimInfo>(`/api/claim/${token}`);
      setInfo(data);
    } catch (e: any) {
      setErr(e.message);
      if (e instanceof ApiError && e.status === 410) {
        setInfo(null);
      }
    }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function attach() {
    if (!user) {
      nav(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!token) return;
    setBusy(true); setErr(null);
    try {
      const data = await api.post<ClaimInfo>(`/api/claim/${token}/attach`);
      setInfo(data);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (err && !info) {
    return (
      <div className="container" style={{ maxWidth: 640 }}>
        <div className="error" style={{ marginTop: 24 }}>{err}</div>
        <Link to="/" className="ghost" style={{ marginTop: 16, display: "inline-block" }}>← На главную</Link>
      </div>
    );
  }
  if (!info) {
    return <div className="container"><div className="empty">Загрузка...</div></div>;
  }

  const isMine = info.claimed_by_user_id != null && user != null && info.claimed_by_user_id === user.id;
  const isClaimedByOther = info.claimed_by_user_id != null && (!user || info.claimed_by_user_id !== user.id);

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="card" style={{ marginTop: 24 }}>
        <div className="row gap" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
          {info.movie_poster_url && (
            <img
              src={info.movie_poster_url}
              alt=""
              style={{ width: 100, height: 150, objectFit: "cover", borderRadius: 6 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 style={{ marginTop: 0, marginBottom: 8, fontSize: 22 }}>{info.movie_title}</h1>
            <div className="muted">{fmt(info.screening_starts_at)}</div>
            <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
              {info.city_name} · {info.rooftop_name}
            </div>
            {info.rooftop_address && (
              <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                📍 {info.rooftop_address}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <span className="badge accent">Гостей: {info.guests_count}</span>
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Пригласил(а): {info.main_booker_full_name || "—"}
            </div>
          </div>
        </div>
      </div>

      {info.is_paid && info.qr_token && info.short_code ? (
        <div className="card" style={{ marginTop: 16, textAlign: "center" }}>
          <h3 style={{ marginTop: 0 }}>Ваш QR-код для входа</h3>
          <img
            src={qrImageUrl(info.qr_token)}
            alt="QR"
            style={{ background: "#fff", padding: 12, borderRadius: 8, maxWidth: "100%" }}
          />
          <div style={{ marginTop: 12, fontSize: 13 }} className="muted">
            Если QR не считается на входе — назовите код:
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 28, letterSpacing: ".15em", marginTop: 6 }}>
            {info.short_code}
          </div>
        </div>
      ) : (
        <div className="hint-box" style={{ marginTop: 16 }}>
          <b>QR-код появится после подтверждения оплаты организатором.</b>
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 13 }}>
            Главный бронирующий ({info.main_booker_full_name}) ещё не закрыл оплату.
            Как только это произойдёт — обновите эту страницу или откройте ссылку из письма повторно,
            появится QR-код и числовой код входа.
          </p>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        {isMine ? (
          <div className="row gap" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <span className="badge accent">Привязано к вашему аккаунту</span>
            <Link to="/profile/tickets" className="rooftop-link">Посмотреть в «Моих QR-кодах» →</Link>
          </div>
        ) : isClaimedByOther ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Бронь уже привязана к другому аккаунту. Если это ошибка — попросите главного бронирующего
            переотправить ссылку или удалить и добавить заново.
          </div>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>Сохранить бронь в аккаунт?</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Привязав бронь к аккаунту, вы увидите её в разделе «Мои QR-коды» и не потеряете ссылку.
              Это необязательно — бронь доступна и по этой странице.
            </p>
            <button className="primary" onClick={attach} disabled={busy}>
              {user ? "Привязать к моему аккаунту" : "Войти и привязать"}
            </button>
            {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
          </>
        )}
      </div>

      <p className="muted" style={{ marginTop: 16, fontSize: 12, textAlign: "center" }}>
        Сохраните эту ссылку — по ней бронь открывается без логина.
      </p>
    </div>
  );
}
