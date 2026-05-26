import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

/** Определяет, запущено ли приложение как установленный PWA (standalone-режим). */
function useIsPWA() {
  const [isPWA, setIsPWA] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true,
  );
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const h = () => setIsPWA(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return isPWA;
}

export default function Header() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const isPWA = useIsPWA();

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

  // Ссылки для десктопного меню и drawer (Установить скрываем в PWA — уже установлено).
  // Порядок: Афиша → Брони → Админ → Профиль (Профиль всегда последним, как «свой» раздел).
  const links: { to: string; label: string; end?: boolean }[] = [{ to: "/", label: "Афиша", end: true }];
  if (user) links.push({ to: "/bookings", label: "Мои брони" });
  if (user?.role === "super_admin" || user?.role === "admin") links.push({ to: "/admin", label: "Админ" });
  if (user) links.push({ to: "/profile", label: "Профиль" });
  if (!isPWA) links.push({ to: "/install", label: "Установить" });

  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  const initials = (user?.full_name || user?.email || "")
    .split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

  function doLogout() {
    logout();
    setOpen(false);
    nav("/");
  }

  return (
    <>
      {/* ── Верхняя шапка ── */}
      <header className={"site-header" + (open ? " menu-open" : "")}>
        <div className="header-inner">
          <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
            Кино на крыше
          </NavLink>

          {/* Десктопная навигация (≥ 880px) */}
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

            {/* Бургер — только на промежуточных экранах (скрыт и на мобильных, и на десктопе CSS-ом) */}
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

      {/* Затемнение под drawer */}
      <div className={"menu-backdrop" + (open ? " show" : "")} onClick={() => setOpen(false)} />

      {/* Выдвижное меню (только ≥ 880px при необходимости, на мобильных скрыто) */}
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

      {/* ── Нижняя навигация (только мобильные < 880px) ── */}
      <nav className="bottom-nav" aria-label="Основная навигация">

        {/* Афиша */}
        <NavLink to="/" end className={({ isActive }) => "bnav-item" + (isActive ? " active" : "")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span>Афиша</span>
        </NavLink>

        {/* Брони (только авторизован) */}
        {user && (
          <NavLink to="/bookings" className={({ isActive }) => "bnav-item" + (isActive ? " active" : "")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
            </svg>
            <span>Брони</span>
          </NavLink>
        )}

        {/* Админ (только admin/super_admin) — идёт раньше Профиля */}
        {isAdmin && (
          <NavLink to="/admin" className={({ isActive }) => "bnav-item" + (isActive ? " active" : "")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span>Админ</span>
          </NavLink>
        )}

        {/* Профиль (только авторизован) — всегда последним */}
        {user && (
          <NavLink to="/profile" className={({ isActive }) => "bnav-item" + (isActive ? " active" : "")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Профиль</span>
          </NavLink>
        )}

        {/* Войти (только не авторизован) */}
        {!user && (
          <NavLink to="/login" className={({ isActive }) => "bnav-item" + (isActive ? " active" : "")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            <span>Войти</span>
          </NavLink>
        )}

      </nav>
    </>
  );
}
