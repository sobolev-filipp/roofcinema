import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";

type Period = "month" | "week";

type Bucket = {
  period_start: string;
  period_end: string;
  label: string;
  screenings: number;
  paid_bookings: number;
  attendees: number;
  revenue: number;
  cancellations: number;
  transfers: number;
};

type StatsResp = {
  period: Period;
  buckets: Bucket[];
  totals: {
    screenings: number;
    paid_bookings: number;
    attendees: number;
    revenue: number;
    cancellations: number;
    transfers: number;
  };
};

type Metric = "revenue" | "screenings" | "attendees" | "cancellations" | "transfers";

const METRIC_LABELS: Record<Metric, string> = {
  revenue: "Выручка, ₽",
  screenings: "Показы",
  attendees: "Гости",
  cancellations: "Отмены",
  transfers: "Переносы",
};

const METRIC_COLORS: Record<Metric, string> = {
  revenue: "var(--accent)",
  screenings: "var(--ok)",
  attendees: "#5b8def",
  cancellations: "var(--warn)",
  transfers: "#a78bfa",
};

const fmtNumber = (n: number) => n.toLocaleString("ru-RU");
const fmtMoney = (n: number) => `${fmtNumber(Math.round(n))} ₽`;

/** Сдвиг конечной даты на N периодов назад/вперёд. */
function shiftEndDate(period: Period, currentEnd: string, deltaPeriods: number): string {
  const d = new Date(currentEnd);
  if (period === "month") {
    d.setMonth(d.getMonth() + deltaPeriods);
  } else {
    d.setDate(d.getDate() + deltaPeriods * 7);
  }
  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function StatisticsAdmin() {
  const [period, setPeriod] = useState<Period>("month");
  const [count, setCount] = useState<number>(12);
  const [endDate, setEndDate] = useState<string>(todayISO());
  const [data, setData] = useState<StatsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("revenue");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams({
      period,
      count: String(count),
      end_date: endDate,
    });
    api.get<StatsResp>(`/api/admin/statistics?${params.toString()}`)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e?.message || "Не удалось загрузить статистику"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, count, endDate]);

  // Максимум по выбранной метрике — нужен для масштабирования столбцов
  const maxValue = useMemo(() => {
    if (!data) return 0;
    return Math.max(1, ...data.buckets.map((b) => Number(b[metric])));
  }, [data, metric]);

  function shift(delta: number) {
    setEndDate((cur) => shiftEndDate(period, cur, delta));
  }

  function resetToToday() {
    setEndDate(todayISO());
  }

  const isAtToday = endDate === todayISO();

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Статистика</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Сводка по показам, гостям, выручке и отменам. Можно листать назад в историю.
      </p>

      {/* Управление: период + количество бакетов + навигация по диапазону */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row gap" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "0 1 auto", minWidth: 220, marginBottom: 0 }}>
            <label>Период</label>
            <div className="seg">
              <button type="button" className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>
                По месяцам
              </button>
              <button type="button" className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>
                По неделям
              </button>
            </div>
          </div>

          <div className="field" style={{ flex: "0 1 auto", minWidth: 130, marginBottom: 0 }}>
            <label>Сколько {period === "month" ? "месяцев" : "недель"}</label>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[4, 6, 8, 12, 24, 52].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <div className="field" style={{ flex: "1 1 200px", marginBottom: 0 }}>
            <label>Конец диапазона</label>
            <div className="row gap" style={{ alignItems: "center" }}>
              <button type="button" className="ghost" onClick={() => shift(-1)} title="Сдвинуть назад">←</button>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="ghost" onClick={() => shift(1)} disabled={isAtToday} title="Сдвинуть вперёд">→</button>
              {!isAtToday && (
                <button type="button" className="ghost" onClick={resetToToday} title="Сегодня">сегодня</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      {/* Сводные карточки */}
      {data && (
        <div className="stats-totals" style={{ marginTop: 16 }}>
          <div className="stats-total-card">
            <div className="stc-label">Выручка</div>
            <div className="stc-value">{fmtMoney(data.totals.revenue)}</div>
          </div>
          <div className="stats-total-card">
            <div className="stc-label">Показов</div>
            <div className="stc-value">{fmtNumber(data.totals.screenings)}</div>
          </div>
          <div className="stats-total-card">
            <div className="stc-label">Гостей</div>
            <div className="stc-value">{fmtNumber(data.totals.attendees)}</div>
            <div className="stc-meta muted">
              {fmtNumber(data.totals.paid_bookings)} оплаченных броней
            </div>
          </div>
          <div className="stats-total-card">
            <div className="stc-label">Отмен</div>
            <div className="stc-value">{fmtNumber(data.totals.cancellations)}</div>
          </div>
          <div className="stats-total-card">
            <div className="stc-label">Переносов</div>
            <div className="stc-value">{fmtNumber(data.totals.transfers)}</div>
          </div>
        </div>
      )}

      {/* Переключатель метрики для графика */}
      {data && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row between" style={{ flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>График: {METRIC_LABELS[metric]}</h3>
            <div className="seg" style={{ width: "auto" }}>
              {(["revenue", "screenings", "attendees", "cancellations", "transfers"] as Metric[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={metric === m ? "active" : ""}
                  onClick={() => setMetric(m)}
                >
                  {METRIC_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="empty" style={{ marginTop: 16 }}>Загрузка...</div>
          ) : (
            <div className="bar-chart" style={{ marginTop: 16 }}>
              {data.buckets.map((b) => {
                const val = Number(b[metric]);
                const pct = maxValue > 0 ? (val / maxValue) * 100 : 0;
                const isZero = val === 0;
                return (
                  <div key={b.period_start} className="bar-col" title={`${b.label}: ${metric === "revenue" ? fmtMoney(val) : fmtNumber(val)}`}>
                    <div className="bar-value">{metric === "revenue" ? fmtMoney(val) : fmtNumber(val)}</div>
                    <div className="bar-track">
                      <div
                        className={"bar-fill" + (isZero ? " bar-zero" : "")}
                        style={{
                          height: `${pct}%`,
                          background: isZero ? "var(--border)" : METRIC_COLORS[metric],
                        }}
                      />
                    </div>
                    <div className="bar-label">{b.label}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Подробная таблица по бакетам */}
      {data && data.buckets.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Подробно по {period === "month" ? "месяцам" : "неделям"}</h3>
          <div className="stats-table">
            <div className="stats-table-header">
              <span>Период</span>
              <span>Показы</span>
              <span>Гости</span>
              <span>Выручка</span>
              <span>Отмены</span>
              <span>Переносы</span>
            </div>
            {data.buckets.map((b) => (
              <div key={b.period_start} className="stats-table-row">
                <span><b>{b.label}</b></span>
                <span>{fmtNumber(b.screenings)}</span>
                <span>
                  {fmtNumber(b.attendees)}
                  {b.paid_bookings > 0 && (
                    <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>
                      ({fmtNumber(b.paid_bookings)} бр.)
                    </span>
                  )}
                </span>
                <span style={{ fontWeight: 600 }}>{fmtMoney(b.revenue)}</span>
                <span style={{ color: b.cancellations > 0 ? "var(--warn)" : undefined }}>
                  {fmtNumber(b.cancellations)}
                </span>
                <span>{fmtNumber(b.transfers)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
