import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Spinner } from "../components/Loaders";
import { useUI } from "../ui";

type Session = {
  id: number;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  is_current: boolean;
};

const fmt = (iso: string) =>
  new Date(iso + (/[Zz]$/.test(iso) ? "" : "Z")).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

function uaShort(ua: string | null): string {
  if (!ua) return "Неизвестное устройство";
  const u = ua;
  if (/iPhone/i.test(u)) return "iPhone · Safari";
  if (/iPad/i.test(u)) return "iPad · Safari";
  if (/Android/i.test(u)) return "Android";
  if (/Edg\//i.test(u)) return "Edge · Desktop";
  if (/Chrome/i.test(u)) return "Chrome · Desktop";
  if (/Firefox/i.test(u)) return "Firefox · Desktop";
  if (/Safari/i.test(u)) return "Safari · Desktop";
  return u.slice(0, 60);
}

export default function SecurityPage() {
  const { user, logout } = useAuth();
  const { confirm } = useUI();
  const nav = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try { setSessions(await api.get<Session[]>("/api/users/me/sessions")); } catch {}
  }
  useEffect(() => { reload(); }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null);
    if (pw !== pw2) { setErr("Пароли не совпадают"); return; }
    setBusy(true);
    try {
      await api.post("/api/users/me/change-password", { current_password: cur, new_password: pw });
      setCur(""); setPw(""); setPw2("");
      setInfo("Пароль обновлён. Все другие сессии завершены.");
      await reload();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function sendReset() {
    if (!user?.email) return;
    setErr(null); setInfo(null);
    const ok = await confirm({
      title: "Сбросить пароль по email?",
      message: `На ${user.email} придёт ссылка для установки нового пароля. Подходит, если вы забыли текущий.`,
      confirmText: "Отправить ссылку",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post("/api/auth/forgot-password", { email: user.email });
      setInfo(`Ссылка для сброса пароля отправлена на ${user.email}. Проверьте почту (в т.ч. «Спам»).`);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function revoke(s: Session) {
    const ok = await confirm({
      title: "Завершить сессию?",
      message: s.is_current ? "Текущая сессия — вас разлогинит." : "Это устройство выйдет из аккаунта.",
      confirmText: "Завершить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/api/users/me/sessions/${s.id}/revoke`);
      if (s.is_current) { logout(); nav("/login"); return; }
      await reload();
    } catch (e: any) { setErr(e.message); }
  }
  async function revokeAllOthers() {
    const ok = await confirm({
      title: "Завершить все другие сессии?",
      message: "Все устройства кроме текущего выйдут из аккаунта.",
      confirmText: "Завершить все",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post("/api/users/me/sessions/revoke-all-except-current");
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <Link to="/profile" className="btn-as-link ghost btn-sm" style={{ display: "inline-flex" }}>← К профилю</Link>
      <h1 style={{ marginTop: 16 }}>Безопасность</h1>

      {err && <div className="error">{err}</div>}
      {info && <div className="hint-box" style={{ marginBottom: 12 }}>{info}</div>}

      <h2 style={{ marginTop: 20 }}>Изменить пароль</h2>
      <form onSubmit={changePassword} className="card">
        <div className="field">
          <label>Текущий пароль</label>
          <input type="password" required value={cur} onChange={(e) => setCur(e.target.value)} />
        </div>
        <div className="field">
          <label>Новый пароль (мин. 6)</label>
          <input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="field">
          <label>Повторите новый пароль</label>
          <input type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Меняем..." : "Сменить пароль"}
        </button>
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Забыли текущий пароль? Можно сбросить его по ссылке на почту.
          </div>
          <button type="button" className="ghost btn-sm" onClick={sendReset} disabled={busy}>
            Сбросить пароль по email
          </button>
        </div>
      </form>

      <h2 style={{ marginTop: 32 }}>Активные сессии</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Каждое устройство, на котором вы вошли. Можно завершить любую сессию.
      </p>

      {sessions.length > 1 && (
        <button className="ghost" onClick={revokeAllOthers} style={{ marginBottom: 12 }}>
          Завершить все, кроме текущей
        </button>
      )}

      <div className="sessions-list">
        {sessions.map((s) => (
          <div key={s.id} className={"card session-card" + (s.is_current ? " current" : "")}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row gap" style={{ alignItems: "baseline" }}>
                <b>{uaShort(s.user_agent)}</b>
                {s.is_current && <span className="badge accent">текущая</span>}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>IP: {s.ip || "—"}</div>
              <div className="muted" style={{ fontSize: 12 }}>Вход: {fmt(s.created_at)}</div>
              <div className="muted" style={{ fontSize: 12 }}>Активность: {fmt(s.last_seen_at)}</div>
            </div>
            <button className="ghost danger-on-hover btn-sm" onClick={() => revoke(s)}>Завершить</button>
          </div>
        ))}
        {sessions.length === 0 && <div className="empty">Активных сессий нет.</div>}
      </div>
    </div>
  );
}
