import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { useTheme } from "../theme";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Владелец",
  admin: "Администратор",
  user: "Пользователь",
};

export default function ProfilePage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  if (!user) return null;

  const initials = (user.full_name || user.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1>Профиль</h1>

      {!user.is_email_verified && (
        <div className="verify-banner">
          <div>
            <b>Email не подтверждён.</b>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Подтвердите {user.email}, чтобы защитить аккаунт и восстановить пароль при необходимости.
            </div>
          </div>
          <Link to="/verify-email" className="btn-as-link primary btn-sm">Подтвердить</Link>
        </div>
      )}

      <div className="card profile-head">
        <div className="profile-avatar">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" />
          ) : (
            <span>{initials || "—"}</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{user.full_name || "Без имени"}</h2>
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{user.email}</div>
          <div style={{ marginTop: 8 }}>
            <span className="badge accent">{ROLE_LABEL[user.role] ?? user.role}</span>
          </div>
          {user.bio && <p style={{ marginTop: 12 }}>{user.bio}</p>}
          {(user.phone || user.social_url) && (
            <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              {user.phone && <span>{user.phone}</span>}
              {user.phone && user.social_url && <span> · </span>}
              {user.social_url && <a href={user.social_url} target="_blank" rel="noopener" className="rooftop-link">{user.social_url}</a>}
            </div>
          )}
        </div>
        <Link to="/profile/edit" className="btn-as-link">Редактировать</Link>
      </div>

      <div className="profile-stats">
        <div className="card stat-card">
          <div className="stat-label">Баланс</div>
          <div className="stat-value">{Number(user.balance).toFixed(0)} <span style={{ fontSize: 16 }}>₽</span></div>
          <div className="muted" style={{ fontSize: 12 }}>Можно использовать для оплаты броней</div>
        </div>
      </div>

      <div className="profile-links">
        <Link to="/bookings" className="profile-link-card card">
          <div>
            <div className="pl-title">Мои бронирования</div>
            <div className="muted" style={{ fontSize: 13 }}>Активные с таймером и история отмен</div>
          </div>
          <span className="pl-arrow">→</span>
        </Link>
        <Link to="/profile/tickets" className="profile-link-card card">
          <div>
            <div className="pl-title">Мои QR-коды</div>
            <div className="muted" style={{ fontSize: 13 }}>Оплаченные брони с QR для входа</div>
          </div>
          <span className="pl-arrow">→</span>
        </Link>
        <Link to="/profile/security" className="profile-link-card card">
          <div>
            <div className="pl-title">Безопасность</div>
            <div className="muted" style={{ fontSize: 13 }}>Пароль и активные сессии</div>
          </div>
          <span className="pl-arrow">→</span>
        </Link>

        {/* Внешний вид — переключатель темы (настройка, не ссылка) */}
        <div className="card profile-setting-card">
          <div style={{ flex: 1 }}>
            <div className="pl-title">Внешний вид</div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Цветовая тема приложения
            </div>
            <div className="seg" style={{ maxWidth: 320 }}>
              <button
                type="button"
                className={theme === "dark" ? "active" : ""}
                onClick={() => setTheme("dark")}
              >
                🌙 Тёмная
              </button>
              <button
                type="button"
                className={theme === "light" ? "active" : ""}
                onClick={() => setTheme("light")}
              >
                ☀ Светлая
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
