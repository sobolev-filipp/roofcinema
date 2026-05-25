import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export default function InitialSetupPage() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState(user?.full_name ?? "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw !== pw2) { setErr("Пароли не совпадают"); return; }
    setBusy(true);
    try {
      await api.post("/api/users/me/initial-setup", {
        new_email: email,
        new_password: pw,
        full_name: name || null,
      });
      await refresh();
      nav("/verify-email", { replace: true });
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Первичная настройка</h1>
        <p className="sub">
          Вы зашли с дефолтным логином владельца. Из соображений безопасности
          укажите <b style={{ color: "var(--text)" }}>свой email и новый пароль</b>.
          После сохранения нужно будет подтвердить email кодом из письма.
        </p>

        {err && <div className="error">{err}</div>}

        <div className="field">
          <label>Ваше имя</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Иванов" />
        </div>
        <div className="field">
          <label>Новый email</label>
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="вы@почта.ру" />
        </div>
        <div className="field">
          <label>Новый пароль (мин. 6 символов)</label>
          <input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="field">
          <label>Повторите пароль</label>
          <input type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <button className="primary btn-block" type="submit" disabled={busy}>
          {busy ? "Сохраняем..." : "Сохранить и подтвердить email"}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          После сохранения дефолтный логин <code>{user?.email}</code> перестаёт работать.
          На указанный email мы отправим код подтверждения. Если SMTP не настроен — код будет в консоли backend.
        </p>
      </form>
    </div>
  );
}
