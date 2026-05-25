import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
      nav(next, { replace: true });
    } catch (e: any) {
      setErr(e.message || "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Вход</h1>
        <p className="sub">Твой вечер на крыше начинается здесь.</p>
        {err && <div className="error">{err}</div>}
        <div className="field">
          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Входим..." : "Войти"}
        </button>
        <div className="auth-switch">
          <Link to="/forgot-password">Забыли пароль?</Link>
        </div>
        <div className="auth-switch">
          Нет аккаунта? <Link to={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Зарегистрироваться</Link>
        </div>
      </form>
    </div>
  );
}
