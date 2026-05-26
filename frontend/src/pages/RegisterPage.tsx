import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type City } from "../api";
import { useAuth } from "../auth";
import { Spinner } from "../components/Loaders";

export default function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [cities, setCities] = useState<City[]>([]);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    home_city_id: null as number | null,
    pd_consent: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<City[]>("/api/cities").then(setCities).catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await register(form);
      // Сразу отправляем на подтверждение email — без него в аккаунт не пускаем
      nav("/verify-email", { replace: true });
    } catch (e: any) {
      setErr(e.message || "Ошибка регистрации");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Регистрация</h1>
        <p className="sub">Выбери свой город — фильмы покажем только из него.</p>
        {err && <div className="error">{err}</div>}
        <div className="field">
          <label>ФИО</label>
          <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field">
          <label>Пароль (мин. 6 символов)</label>
          <input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div className="field">
          <label>Город</label>
          <select
            value={form.home_city_id ?? ""}
            onChange={(e) => setForm({ ...form, home_city_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Не выбран</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.pd_consent}
            onChange={(e) => setForm({ ...form, pd_consent: e.target.checked })}
          />
          <span>
            Я согласен на обработку моих персональных данных в соответствии с
            Политикой конфиденциальности (152-ФЗ).
          </span>
        </label>
        <button className="primary" type="submit" disabled={busy || !form.pd_consent} style={{ width: "100%", marginTop: 16 }}>
          {busy && <Spinner />}
          {busy ? "Создаём аккаунт..." : "Создать аккаунт"}
        </button>
        <div className="auth-switch">
          Уже есть аккаунт? <Link to={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Войти</Link>
        </div>
      </form>
    </div>
  );
}
