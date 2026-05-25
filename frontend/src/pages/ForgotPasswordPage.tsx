import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post("/api/auth/forgot-password", { email });
      setSent(true);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Сброс пароля</h1>
        {!sent ? (
          <>
            <p className="sub">Укажите email — отправим ссылку для смены пароля.</p>
            {err && <div className="error">{err}</div>}
            <div className="field">
              <label>Email</label>
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="primary btn-block" type="submit" disabled={busy}>
              {busy ? "Отправляем..." : "Отправить ссылку"}
            </button>
          </>
        ) : (
          <>
            <p className="sub">
              Если такой email есть в базе, мы отправили на него ссылку для сброса пароля.
              Проверьте почту (и папку «Спам»).
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              Если SMTP не настроен на бэке — ссылка появится в консоли backend с пометкой <code>[DEV-EMAIL]</code>.
            </p>
          </>
        )}
        <div className="auth-switch">
          <Link to="/login">← Назад ко входу</Link>
        </div>
      </form>
    </div>
  );
}
