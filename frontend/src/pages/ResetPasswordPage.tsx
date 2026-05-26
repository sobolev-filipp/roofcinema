import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Spinner } from "../components/Loaders";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setErr("Пароли не совпадают"); return; }
    setBusy(true); setErr(null);
    try {
      await api.post("/api/auth/reset-password", { token, new_password: pw });
      setDone(true);
      setTimeout(() => nav("/login", { replace: true }), 1500);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Новый пароль</h1>
        {!token ? (
          <div className="error">Нет токена в ссылке. Запросите новую ссылку.</div>
        ) : done ? (
          <p className="sub">Пароль обновлён. Перенаправляем на страницу входа...</p>
        ) : (
          <>
            <p className="sub">Введите новый пароль для своего аккаунта.</p>
            {err && <div className="error">{err}</div>}
            <div className="field">
              <label>Новый пароль (мин. 6 символов)</label>
              <input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Повторите пароль</label>
              <input type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <button className="primary btn-block" type="submit" disabled={busy}>
              {busy && <Spinner />}
              {busy ? "Сохраняем..." : "Сохранить"}
            </button>
          </>
        )}
        <div className="auth-switch">
          <Link to="/login">← Назад ко входу</Link>
        </div>
      </form>
    </div>
  );
}
