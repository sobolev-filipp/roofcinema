export type DateMode = "day" | "week" | "month";

export type DateRange = {
  mode: DateMode;
  /** Якорная дата периода (для day = сама дата, для week = понедельник, для month = 1-е число). */
  anchor: Date;
};

const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTHS_RU_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  // в JS getDay(): 0 = Sun .. 6 = Sat. Берём понедельник как начало.
  const dow = (x.getDay() + 6) % 7; // 0 = Mon .. 6 = Sun
  x.setDate(x.getDate() - dow);
  return x;
}

export function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

/** Возвращает [from, to) для текущего якоря в выбранном режиме. */
export function rangeBounds(range: DateRange): { from: Date; to: Date } {
  if (range.mode === "day") {
    const from = startOfDay(range.anchor);
    return { from, to: addDays(from, 1) };
  }
  if (range.mode === "week") {
    const from = startOfWeek(range.anchor);
    return { from, to: addDays(from, 7) };
  }
  const from = startOfMonth(range.anchor);
  return { from, to: addMonths(from, 1) };
}

export function rangeLabel(range: DateRange): string {
  const { from, to } = rangeBounds(range);
  const today = startOfDay(new Date());
  if (range.mode === "day") {
    const diff = Math.round((from.getTime() - today.getTime()) / 86400000);
    const main = `${from.getDate()} ${MONTHS_RU[from.getMonth()]}`;
    if (diff === 0) return `Сегодня · ${main}`;
    if (diff === 1) return `Завтра · ${main}`;
    if (diff === -1) return `Вчера · ${main}`;
    return main;
  }
  if (range.mode === "week") {
    const last = addDays(to, -1);
    const sameMonth = from.getMonth() === last.getMonth();
    if (sameMonth) {
      return `${from.getDate()}–${last.getDate()} ${MONTHS_RU[from.getMonth()]}`;
    }
    return `${from.getDate()} ${MONTHS_RU[from.getMonth()]} – ${last.getDate()} ${MONTHS_RU[last.getMonth()]}`;
  }
  return `${MONTHS_RU_NOM[from.getMonth()]} ${from.getFullYear()}`;
}

export function step(range: DateRange, dir: -1 | 1): DateRange {
  if (range.mode === "day") return { ...range, anchor: addDays(range.anchor, dir) };
  if (range.mode === "week") return { ...range, anchor: addDays(range.anchor, dir * 7) };
  return { ...range, anchor: addMonths(range.anchor, dir) };
}

export function defaultRange(mode: DateMode): DateRange {
  return { mode, anchor: startOfDay(new Date()) };
}

/** Сериализует Date как наивную локальную ISO-строку для бэка. */
export function toNaiveIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function DateFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  function setMode(mode: DateMode) {
    if (mode === value.mode) return;
    const anchor =
      mode === "day"
        ? startOfDay(new Date())
        : mode === "week"
        ? startOfWeek(new Date())
        : startOfMonth(new Date());
    onChange({ mode, anchor });
  }

  return (
    <div className="date-filter">
      <div className="seg">
        <button type="button" className={value.mode === "day" ? "active" : ""} onClick={() => setMode("day")}>Сегодня</button>
        <button type="button" className={value.mode === "week" ? "active" : ""} onClick={() => setMode("week")}>Неделя</button>
        <button type="button" className={value.mode === "month" ? "active" : ""} onClick={() => setMode("month")}>Месяц</button>
      </div>
      <div className="date-nav">
        <button type="button" className="nav-btn" onClick={() => onChange(step(value, -1))} aria-label="Назад">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="date-label">{rangeLabel(value)}</span>
        <button type="button" className="nav-btn" onClick={() => onChange(step(value, 1))} aria-label="Вперёд">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <button type="button" className="ghost today-btn" onClick={() => onChange(defaultRange(value.mode))}>Сейчас</button>
      </div>
    </div>
  );
}
