import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function Header() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  // закрываем меню при переходе на другую страницу
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  // блокируем прокрутку body когда меню открыто
  useEffect(() => {
    if (open) document.body.classList.add("no-scroll");
    else document.body.classList.remove("no-scroll");
    return () => document.body.classList.remove("no-scroll");
  }, [open]);

  // ESC закрывает меню
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  const links: { to: string; label: string; end?: boolean }[] = [{ to: "/", label: "Афиша", end: true }];
  if (user) links.push({ to: "/bookings", label: "Мои брони" }, { to: "/profile", label: "Профиль" });
  if (user?.role === "super_admin") links.push({ to: "/admin", label: "Админ" });

  const initials = (user?.full_name || user?.email || "")
    .split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

  function doLogout() {
    logout();
    setOpen(false);
    nav("/");
  }

  return (
    <>
      <header className={"site-header" + (open ? " menu-open" : "")}>
        <div className="header-inner">
          <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
            Кино на крыше
          </NavLink>

          <nav className="nav-desktop">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="header-actions">
            {user ? (
              <div className="user-chip-desktop">
                <NavLink to="/profile" className="user-chip-link" title="Перейти в профиль">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="user-chip-avatar" />
                  ) : (
                    <span className="user-chip-avatar">{initials || "?"}</span>
                  )}
                  <span className="user-chip-name">{user.full_name || user.email.split("@")[0]}</span>
                </NavLink>
                <button className="btn btn-ghost btn-sm" onClick={doLogout}>Выйти</button>
              </div>
            ) : (
              <div className="auth-actions-desktop">
                <button className="btn btn-ghost btn-sm" onClick={() => nav("/login")}>Войти</button>
                <button className="btn btn-primary btn-sm" onClick={() => nav("/register")}>Регистрация</button>
              </div>
            )}

            <button
              type="button"
              className={"burger" + (open ? " open" : "")}
              aria-label={open ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
      </header>

      <div className={"menu-backdrop" + (open ? " show" : "")} onClick={() => setOpen(false)} />

      <aside className={"mobile-drawer" + (open ? " open" : "")} aria-hidden={!open}>
        <button
          type="button"
          className="drawer-close"
          aria-label="Закрыть меню"
          onClick={() => setOpen(false)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6l-12 12" />
          </svg>
        </button>

        {user && (
          <NavLink to="/profile" className="drawer-user" onClick={() => setOpen(false)}>
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="drawer-avatar" />
            ) : (
              <span className="drawer-avatar">{initials || "?"}</span>
            )}
            <div className="drawer-user-info">
              <div className="drawer-user-name">{user.full_name || "Без имени"}</div>
              <div className="drawer-user-email">{user.email}</div>
            </div>
            <span className="pl-arrow" aria-hidden>→</span>
          </NavLink>
        )}

        <nav className="drawer-nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => "drawer-link" + (isActive ? " active" : "")}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="drawer-actions">
          {user ? (
            <button className="btn btn-ghost btn-block" onClick={doLogout}>Выйти из аккаунта</button>
          ) : (
            <>
              <button className="btn btn-primary btn-block" onClick={() => nav("/login")}>Войти</button>
              <button className="btn btn-ghost btn-block" onClick={() => nav("/register")}>Зарегистрироваться</button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
