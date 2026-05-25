import { NavLink, Outlet } from "react-router-dom";

const tabs = [
  { to: "/admin/cities",      label: "Города" },
  { to: "/admin/rooftops",    label: "Крыши" },
  { to: "/admin/movies",      label: "Фильмы" },
  { to: "/admin/screenings",  label: "Показы" },
  { to: "/admin/bookings",    label: "Бронирования" },
  { to: "/admin/receipts",    label: "Чеки" },
  { to: "/admin/payout-templates", label: "Реквизиты" },
];

export default function AdminLayout() {
  return (
    <div className="container">
      <h1>Админ-панель</h1>
      <div className="admin-tabs">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => "admin-tab" + (isActive ? " active" : "")}
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
