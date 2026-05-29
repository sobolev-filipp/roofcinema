import { useEffect, useRef, useState } from "react";
import { api, type CheckInConfirmOut, type CheckInInfo } from "../../api";
import { ProjectorLoader } from "../../components/Loaders";

// qr-scanner — lazy import, грузится только если есть камера
type QrScannerType = import("qr-scanner").default;

type Phase =
  | "idle"       // экран ввода кода
  | "scanning"   // камера активна
  | "looking"    // запрос к серверу (lookup)
  | "preview"    // показываем инфо о брони, ждём подтверждения
  | "confirming" // отправляем подтверждение
  | "success"    // ✅ прошёл
  | "already"    // ⚠️ уже отмечен
  | "blocked"    // ❌ нельзя (не тот статус / время)
  | "error";     // ❌ сетевая/неизвестная ошибка

const STATUS_LABELS: Record<string, string> = {
  waiting_payment: "Ожидает оплаты",
  paid: "Оплачена",
  paid_by_balance: "Оплачена (баланс)",
  attended: "Посетил",
  cancelled: "Отменена",
  expired: "Истекла",
  refund_pending: "Ожидает возврата",
  refunded: "Возврат выполнен",
};

export default function CheckInAdmin() {
  const [hasCamera, setHasCamera] = useState<boolean | null>(null); // null = проверяем
  const [phase, setPhase] = useState<Phase>("idle");
  const [confirming, setConfirming] = useState(false); // busy-флаг внутри preview
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<CheckInInfo | null>(null);
  const [confirmResult, setConfirmResult] = useState<CheckInConfirmOut | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [log, setLog] = useState<Array<{ name: string; ok: boolean; time: string }>>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Определяем наличие камеры при монтировании
  useEffect(() => {
    let cancelled = false;
    import("qr-scanner").then(({ default: QrScanner }) => {
      QrScanner.hasCamera().then((has) => {
        if (!cancelled) setHasCamera(has);
      });
    });
    return () => { cancelled = true; };
  }, []);

  // При переходе в idle — фокус на input
  useEffect(() => {
    if (phase === "idle") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [phase]);

  // Автосброс через 5 секунд после success/already/blocked/error
  useEffect(() => {
    if (!["success", "already", "blocked", "error"].includes(phase)) return;
    const t = setTimeout(() => reset(), 5000);
    return () => clearTimeout(t);
  }, [phase]);

  // Запуск / остановка камеры
  useEffect(() => {
    if (phase !== "scanning" || !videoRef.current) return;
    let destroyed = false;

    import("qr-scanner").then(({ default: QrScanner }) => {
      if (destroyed || !videoRef.current) return;
      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          if (phase === "scanning") {
            scanner.stop();
            handleCode(result.data);
          }
        },
        {
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 5,
        },
      );
      scannerRef.current = scanner;
      scanner.start().catch(() => {
        setErrMsg("Не удалось открыть камеру. Разрешите доступ в настройках браузера.");
        setPhase("error");
      });
    });

    return () => {
      destroyed = true;
      if (scannerRef.current) {
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, [phase]); // eslint-disable-line

  function reset() {
    setPhase("idle");
    setConfirming(false);
    setCode("");
    setInfo(null);
    setConfirmResult(null);
    setErrMsg(null);
  }

  async function handleCode(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setPhase("looking");
    setCode(trimmed);
    // Минимальная длительность анимации проектора, чтобы её было видно
    // даже при моментальном ответе сервера.
    const minDelay = new Promise((res) => setTimeout(res, 800));
    try {
      const [result] = await Promise.all([
        api.get<CheckInInfo>(`/api/admin/check-in/lookup?code=${encodeURIComponent(trimmed)}`),
        minDelay,
      ]);
      setInfo(result);
      setPhase("preview");
    } catch (e: any) {
      await minDelay;
      setErrMsg(e.message || "Ошибка запроса");
      setPhase("error");
    }
  }

  async function confirmCheckIn() {
    if (!info) return;
    setConfirming(true);
    try {
      const result = await api.post<CheckInConfirmOut>("/api/admin/check-in/confirm", {
        code: code,
      });
      setConfirmResult(result);
      addLog(info.full_name, true);
      setPhase(result.already_attended ? "already" : "success");
    } catch (e: any) {
      setErrMsg(e.message || "Ошибка подтверждения");
      setPhase("error");
    } finally {
      setConfirming(false);
    }
  }

  function addLog(name: string, ok: boolean) {
    const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    setLog((prev) => [{ name, ok, time }, ...prev].slice(0, 20));
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && code.trim()) handleCode(code);
  }

  // ─── Результирующие экраны ───────────────────────────────────────

  if (phase === "success" || phase === "already") {
    const isAlready = phase === "already";
    return (
      <ResultScreen
        icon={isAlready ? "⚠️" : "✅"}
        color={isAlready ? "#f59e0b" : "#22c55e"}
        title={isAlready ? "Уже отмечен" : "Вход подтверждён"}
        subtitle={info?.full_name ?? ""}
        detail={
          isAlready
            ? "Этот гость уже был отмечен ранее"
            : [
                `${info?.guests_count ?? 1} чел.`,
                info?.seat_breakdown.length
                  ? info.seat_breakdown.map((s) => `${s.name} ×${s.qty}`).join(", ")
                  : null,
                info?.movie_title,
              ].filter(Boolean).join(" · ")
        }
        onReset={reset}
      />
    );
  }

  if (phase === "blocked" || phase === "error") {
    return (
      <ResultScreen
        icon="❌"
        color="#ef4444"
        title={phase === "blocked" ? "Вход невозможен" : "Ошибка"}
        subtitle={errMsg ?? info?.reason ?? "Неизвестная ошибка"}
        detail={info?.full_name}
        onReset={reset}
      />
    );
  }

  // ─── Preview ─────────────────────────────────────────────────────

  if (phase === "preview" && info) {
    const canConfirm = info.can_check_in && !info.already_attended;
    return (
      <div className="checkin-wrap">
        <h2 style={{ marginTop: 0 }}>Проверка кода</h2>

        <div className={`card checkin-preview ${info.can_check_in ? "" : "checkin-preview--blocked"}`}>
          <div className="checkin-movie">{info.movie_title}</div>
          <div className="checkin-time">
            {info.screening_starts_at_fmt} · {info.rooftop_name}
          </div>

          <div className="checkin-guest">
            <div className="checkin-guest-name">{info.full_name}</div>
            <div className="checkin-guest-meta">
              {info.guests_count} {info.guests_count === 1 ? "человек" : "человека"} ·{" "}
              <span className="muted">{STATUS_LABELS[info.booking_status] ?? info.booking_status}</span>
            </div>
            {info.seat_breakdown.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {info.seat_breakdown.map((s) => (
                  <span
                    key={s.name}
                    className="badge"
                    style={{ fontSize: 13, padding: "3px 10px" }}
                  >
                    {s.name} ×{s.qty}
                  </span>
                ))}
              </div>
            )}
          </div>

          {info.already_attended && (
            <div className="hint-box" style={{ background: "rgba(245,158,11,0.12)", borderColor: "#f59e0b", marginTop: 12 }}>
              ⚠️ Этот гость уже был отмечен ранее
            </div>
          )}

          {info.reason && (
            <div className="error" style={{ marginTop: 12 }}>{info.reason}</div>
          )}

          {info.kind === "attendee" && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              QR гостя (разделённая бронь #{info.booking_id})
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="ghost" style={{ flex: 1 }} onClick={reset}>
            ← Назад
          </button>
          {canConfirm ? (
            <button
              className="primary"
              style={{ flex: 2 }}
              onClick={confirmCheckIn}
              disabled={confirming}
            >
              {confirming ? "Подтверждаем..." : "✓ Подтвердить вход"}
            </button>
          ) : (
            <button className="primary" style={{ flex: 2, opacity: 0.5 }} disabled>
              Вход недоступен
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Scanning (камера) ────────────────────────────────────────────

  if (phase === "scanning") {
    return (
      <div className="checkin-wrap">
        <h2 style={{ marginTop: 0 }}>Сканирование QR</h2>
        <div className="checkin-video-wrap">
          <video ref={videoRef} className="checkin-video" />
          {phase === "scanning" && (
            <div className="checkin-hint">Наведите камеру на QR-код</div>
          )}
        </div>
        <button className="ghost" style={{ marginTop: 14, width: "100%" }} onClick={reset}>
          ← Отмена
        </button>
      </div>
    );
  }

  // ─── Looking (загрузка) — кино-проектор ───────────────────────────

  if (phase === "looking") {
    return <ProjectorLoader text="Ищем бронь" />;
  }

  // ─── Idle (основной экран) ────────────────────────────────────────

  return (
    <div className="checkin-wrap">
      <h2 style={{ marginTop: 0 }}>Проверка на входе</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 20 }}>
        Введите короткий код брони (например <code>A1B2C3</code>) или QR-токен,
        либо отсканируйте QR-код с экрана гостя.
      </p>

      <div className="field">
        <label>Код брони / QR-токен</label>
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={onInputKey}
          placeholder="A1B2C3"
          style={{ fontFamily: "monospace", fontSize: 20, letterSpacing: 3, textAlign: "center" }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        {hasCamera && (
          <button
            className="ghost"
            style={{ flex: 1 }}
            onClick={() => setPhase("scanning")}
          >
            📷 Сканировать QR
          </button>
        )}
        <button
          className="primary"
          style={{ flex: hasCamera ? 1 : "1 1 auto" as any }}
          onClick={() => handleCode(code)}
          disabled={!code.trim()}
        >
          Найти →
        </button>
      </div>

      {hasCamera === false && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8, textAlign: "center" }}>
          Камера не обнаружена — используйте ввод кода вручную
        </div>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Последние отметки
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {log.map((entry, i) => (
              <div
                key={i}
                className="card"
                style={{
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 14,
                }}
              >
                <span style={{ fontSize: 18 }}>{entry.ok ? "✅" : "❌"}</span>
                <span style={{ flex: 1 }}>{entry.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>{entry.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Вспомогательный компонент результата ──────────────────────────

function ResultScreen({
  icon, color, title, subtitle, detail, onReset,
}: {
  icon: string;
  color: string;
  title: string;
  subtitle: string;
  detail?: string;
  onReset: () => void;
}) {
  return (
    <div className="checkin-wrap checkin-result">
      <div className="checkin-result-icon" style={{ color }}>{icon}</div>
      <div className="checkin-result-title" style={{ color }}>{title}</div>
      {subtitle && <div className="checkin-result-sub">{subtitle}</div>}
      {detail && <div className="muted" style={{ fontSize: 13, marginTop: 6, textAlign: "center" }}>{detail}</div>}
      <button className="ghost" style={{ marginTop: 24, minWidth: 160 }} onClick={onReset}>
        Следующий гость
      </button>
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Автосброс через 5 секунд
      </div>
    </div>
  );
}
