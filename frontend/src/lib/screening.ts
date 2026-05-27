/**
 * Утилиты для вычисления и форматирования окончания показа.
 *
 * Окончание = явное `ends_at` (если задано) ИЛИ `starts_at + duration_min` минут.
 * `starts_at` хранится как наивное локальное время крыши, поэтому считаем «как видим».
 */

const PAD = (n: number) => String(n).padStart(2, "0");

/** Парсит «YYYY-MM-DDTHH:MM:SS» как локальные компоненты (без TZ-преобразования). */
function parseNaive(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  return new Date(
    parseInt(y, 10),
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(hh, 10),
    parseInt(mm, 10),
    parseInt(ss || "0", 10),
  );
}

/** Вернёт Date окончания показа или null, если ни ends_at, ни duration_min не известны. */
export function computeEndsAt(args: {
  starts_at: string;
  ends_at?: string | null;
  duration_min?: number | null;
}): Date | null {
  if (args.ends_at) {
    return parseNaive(args.ends_at);
  }
  if (!args.duration_min || args.duration_min < 1) return null;
  const start = parseNaive(args.starts_at);
  if (!start) return null;
  return new Date(start.getTime() + args.duration_min * 60_000);
}

/** Форматирует окончание показа.
 *  withDate=false (по умолчанию): только время «HH:MM» — для случаев, когда дата уже видна рядом.
 *  withDate=true: «DD.MM.YYYY HH:MM» — для отдельных строк (шаблоны, письма). */
export function formatEndsAt(
  args: {
    starts_at: string;
    ends_at?: string | null;
    duration_min?: number | null;
  },
  withDate = false,
): string | null {
  const end = computeEndsAt(args);
  if (!end) return null;
  const hhmm = `${PAD(end.getHours())}:${PAD(end.getMinutes())}`;
  if (!withDate) return hhmm;
  return `${PAD(end.getDate())}.${PAD(end.getMonth() + 1)}.${end.getFullYear()} ${hhmm}`;
}

/** «20:00 – 22:30» либо «20:00» если окончание неизвестно. */
export function formatTimeRange(
  starts_at: string,
  ends_at: string | null | undefined,
  duration_min: number | null | undefined,
): string {
  const start = parseNaive(starts_at);
  const startStr = start
    ? `${PAD(start.getHours())}:${PAD(start.getMinutes())}`
    : "";
  const endStr = formatEndsAt({ starts_at, ends_at, duration_min });
  if (!endStr) return startStr;
  return `${startStr} – ${endStr}`;
}
