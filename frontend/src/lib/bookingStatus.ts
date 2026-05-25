import type { BookingStatus } from "../api";

export const STATUS_LABELS: Record<BookingStatus, string> = {
  waiting_payment: "Ждёт оплаты",
  paid: "Оплачено",
  attended: "Посетил",
  no_show: "Не пришёл",
  cancelled: "Отменено",
  expired: "Срок оплаты вышел",
  refund_pending: "Ожидание возврата",
  refunded: "Возврат выполнен",
  paid_by_balance: "Оплачено с баланса",
};

export const STATUS_COLOR: Record<BookingStatus, string> = {
  waiting_payment: "var(--warn)",
  paid: "var(--ok)",
  attended: "var(--ok)",
  no_show: "var(--text-dim)",
  cancelled: "var(--text-dim)",
  expired: "var(--err)",
  refund_pending: "var(--warn)",
  refunded: "var(--text-dim)",
  paid_by_balance: "var(--ok)",
};

/** Парсит ISO-строку как UTC, если в ней нет суффикса таймзоны.
 * Backend отдаёт expires_at/created_at/paid_at/cancelled_at в наивном UTC. */
export function parseUtc(iso: string): Date {
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso)) return new Date(iso);
  return new Date(iso + "Z");
}

/** мс до истечения. Отрицательное → уже истекло. */
export function msUntil(iso: string): number {
  return parseUtc(iso).getTime() - Date.now();
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
