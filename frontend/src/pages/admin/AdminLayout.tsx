import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api";

const tabs = [
  { to: "/admin/cities",      label: "Города", key: "cities" },
  { to: "/admin/rooftops",    label: "Крыши", key: "rooftops" },
  { to: "/admin/movies",      label: "Фильмы", key: "movies" },
  { to: "/admin/screenings",  label: "Показы", key: "screenings" },
  { to: "/admin/bookings",    label: "Бронирования", key: "bookings" },
  { to: "/admin/manual-booking", label: "+ Бронь вручную", key: "manual" },
  { to: "/admin/receipts",    label: "Чеки", key: "receipts" },
  { to: "/admin/refunds",     label: "Возвраты", key: "refunds" },
  { to: "/admin/payout-templates", label: "Реквизиты", key: "payout" },
  { to: "/admin/templates",   label: "Шаблоны", key: "templates" },
];

export default function AdminLayout() {
  const [pendingReceipts, setPendingReceipts] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const r = await api.get<{ count: number }>("/api/admin/receipts/pending-count");
        if (alive) setPendingReceipts(r.count || 0);
      } catch {
        /* тихо игнорируем — счётчик не критичен */
      }
    }
    refresh();
    const t = setInterval(refresh, 30_000);  // обновляем раз в 30 секунд
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, []);

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
            {t.key === "receipts" && pendingReceipts > 0 && (
              <span className="admin-tab-badge" title={`Чеков на проверке: ${pendingReceipts}`}>
                {pendingReceipts}
              </span>
            )}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
