import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";

/** perm=undefined → таб виден всем администраторам (super_admin + admin с любыми правами).
 *  perm=string   → скрывается для admin, у которых нет этого права.
 *  super_admin видит все табы всегда. */
const ALL_TABS = [
  { to: "/admin/cities",           label: "Города",         key: "cities",    perm: undefined },
  { to: "/admin/rooftops",         label: "Крыши",          key: "rooftops",  perm: "manage_rooftops" },
  { to: "/admin/movies",           label: "Фильмы",         key: "movies",    perm: "manage_movies" },
  { to: "/admin/screenings",       label: "Показы",         key: "screenings",perm: "manage_screenings" },
  { to: "/admin/bookings",         label: "Бронирования",   key: "bookings",  perm: "manage_bookings" },
  { to: "/admin/manual-booking",   label: "+ Бронь вручную",key: "manual",    perm: "manual_booking" },
  { to: "/admin/receipts",         label: "Чеки",           key: "receipts",  perm: "manage_receipts" },
  { to: "/admin/refunds",          label: "Возвраты",       key: "refunds",   perm: "manage_refunds" },
  { to: "/admin/payout-templates", label: "Реквизиты",      key: "payout",    perm: "manage_payout_templates" },
  { to: "/admin/templates",        label: "Шаблоны",        key: "templates", perm: "manage_templates" },
  { to: "/admin/check-in",         label: "Вход",           key: "checkin",   perm: "check_in" },
  { to: "/admin/statistics",       label: "Статистика",     key: "stats",     perm: "view_statistics" },
  { to: "/admin/admins",           label: "Администраторы", key: "admins",    perm: "manage_admins" },
] as const;

export default function AdminLayout() {
  const { hasPerm } = useAuth();
  const tabs = ALL_TABS.filter((t) => t.perm === undefined || hasPerm(t.perm));
  const canSeeReceipts = hasPerm("manage_receipts");
  const canSeeRefunds = hasPerm("manage_refunds");
  const [pendingReceipts, setPendingReceipts] = useState<number>(0);
  const [pendingRefunds, setPendingRefunds] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const [receipts, postShow, refunds] = await Promise.all([
          canSeeReceipts
            ? api.get<{ count: number }>("/api/admin/receipts/pending-count")
            : Promise.resolve({ count: 0 }),
          canSeeReceipts
            ? api.get<{ count: number }>("/api/admin/post-show-receipts/pending-count")
            : Promise.resolve({ count: 0 }),
          canSeeRefunds
            ? api.get<{ count: number }>("/api/admin/refund-requests/pending-count")
            : Promise.resolve({ count: 0 }),
        ]);
        if (alive) {
          // Бейдж у пункта «Чеки» суммирует входящие (на проверке) + ждущие отправки
          setPendingReceipts((receipts.count || 0) + (postShow.count || 0));
          setPendingRefunds(refunds.count || 0);
        }
      } catch {
        /* счётчики не критичны */
      }
    }
    refresh();
    const t = setInterval(refresh, 15_000);  // каждые 15 секунд
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [canSeeReceipts, canSeeRefunds]); // eslint-disable-line

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
            {t.key === "refunds" && pendingRefunds > 0 && (
              <span className="admin-tab-badge" title={`Незавершённых возвратов: ${pendingRefunds}`}>
                {pendingRefunds}
              </span>
            )}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
