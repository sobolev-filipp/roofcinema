import { useEffect, useRef, useState } from "react";
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
  { to: "/admin/customers",        label: "Клиенты",        key: "customers", perm: "manage_bookings" },
  { to: "/admin/manual-booking",   label: "+ Бронь вручную",key: "manual",    perm: "manual_booking" },
  { to: "/admin/receipts",         label: "Чеки",           key: "receipts",  perm: "manage_receipts" },
  { to: "/admin/refunds",          label: "Возвраты",       key: "refunds",   perm: "manage_refunds" },
  { to: "/admin/cancellations",    label: "Отмена показа",  key: "cancellations", perm: "manage_cancellations" },
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
  const canSeeCancellations = hasPerm("manage_cancellations");
  const [pendingReceipts, setPendingReceipts] = useState<number>(0);
  const [pendingRefunds, setPendingRefunds] = useState<number>(0);
  const [pendingCancellations, setPendingCancellations] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const [receipts, postShow, refunds, cancellations] = await Promise.all([
          canSeeReceipts
            ? api.get<{ count: number }>("/api/admin/receipts/pending-count")
            : Promise.resolve({ count: 0 }),
          canSeeReceipts
            ? api.get<{ count: number }>("/api/admin/post-show-receipts/pending-count")
            : Promise.resolve({ count: 0 }),
          canSeeRefunds
            ? api.get<{ count: number }>("/api/admin/refund-requests/pending-count")
            : Promise.resolve({ count: 0 }),
          canSeeCancellations
            ? api.get<{ count: number }>("/api/admin/cancellations/pending-count")
            : Promise.resolve({ count: 0 }),
        ]);
        if (alive) {
          // Бейдж у пункта «Чеки» суммирует входящие (на проверке) + ждущие отправки
          setPendingReceipts((receipts.count || 0) + (postShow.count || 0));
          setPendingRefunds(refunds.count || 0);
          setPendingCancellations(cancellations.count || 0);
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
  }, [canSeeReceipts, canSeeRefunds, canSeeCancellations]); // eslint-disable-line

  // Горизонтальный скролл вкладок: колесо мыши крутит вбок + перетаскивание мышью.
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;

    // колесо: вертикальная прокрутка → горизонтальная (если есть что прокручивать)
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };

    // drag-to-scroll: зажал и потащил. Чтобы не мешать клику по вкладке —
    // считаем «перетаскиванием» только сдвиг > 5px.
    let down = false, startX = 0, startLeft = 0, moved = false;
    const onDown = (e: PointerEvent) => {
      down = true; moved = false;
      startX = e.clientX; startLeft = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 5) moved = true;
      el.scrollLeft = startLeft - dx;
    };
    const onUp = () => { down = false; };
    // если тащили — гасим клик по ссылке, чтобы не было случайной навигации
    const onClick = (e: MouseEvent) => { if (moved) { e.preventDefault(); e.stopPropagation(); } };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("click", onClick, true);
    };
  }, []);

  return (
    <div className="container">
      <h1>Админ-панель</h1>
      <div className="admin-tabs" ref={tabsRef}>
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
            {t.key === "cancellations" && pendingCancellations > 0 && (
              <span className="admin-tab-badge" title={`Ждут решения по отменённым показам: ${pendingCancellations}`}>
                {pendingCancellations}
              </span>
            )}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
