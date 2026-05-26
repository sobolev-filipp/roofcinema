import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import PinInput from "../components/PinInput";
import { Spinner } from "../components/Loaders";

type Step = "credentials" | "code";

const RESEND_COOLDOWN = 60; // секунд

export default function LoginPage() {
  const { login, verifyLogin } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";

  // Шаг 1 — логин/пароль
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Шаг 2 — OTP
  const [step, setStep] = useState<Step>("credentials");
  const [mfaToken, setMfaToken] = useState("");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // таймер обратного отсчёта истечения кода
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  // таймер кулдауна повторной отправки
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // автосабмит когда введены все 6 цифр
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (code.length === 6 && !busy && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      submitCode(code);
    }
    if (code.length < 6) autoSubmittedRef.current = false;
  }, [code]); // eslint-disable-line

  // ── Шаг 1: отправить логин/пароль ───────────────────────────────────────

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const challenge = await login(email, password);
      setMfaToken(challenge.mfa_token);
      setExpiresAt(new Date(Date.now() + challenge.expires_in * 1000));
      setSecondsLeft(challenge.expires_in);
      setResendCooldown(RESEND_COOLDOWN);
      setCode("");
      setStep("code");
    } catch (e: any) {
      setErr(e.message || "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  // ── Шаг 2: подтвердить OTP-код ──────────────────────────────────────────

  async function submitCode(value: string) {
    setBusy(true);
    setErr(null);
    try {
      await verifyLogin(mfaToken, value);
      nav(next, { replace: true });
    } catch (e: any) {
      setErr(e.message || "Неверный код");
      setBusy(false);
    }
  }

  async function onCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6) return;
    await submitCode(code);
  }

  async function onResend() {
    if (resendCooldown > 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post<{ mfa_token: string; expires_in: number }>(
        "/api/auth/login-resend",
        { mfa_token: mfaToken },
      );
      setMfaToken(res.mfa_token);
      setExpiresAt(new Date(Date.now() + res.expires_in * 1000));
      setSecondsLeft(res.expires_in);
      setResendCooldown(RESEND_COOLDOWN);
      setCode("");
      autoSubmittedRef.current = false;
    } catch (e: any) {
      setErr(e.message || "Ошибка повторной отправки");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    setStep("credentials");
    setCode("");
    setErr(null);
    setMfaToken("");
    setExpiresAt(null);
  }

  // ── Рендер ──────────────────────────────────────────────────────────────

  if (step === "code") {
    const expired = secondsLeft <= 0;
    const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
    const ss = String(secondsLeft % 60).padStart(2, "0");

    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={onCodeSubmit}>
          <h1>Подтверждение входа</h1>
          <p className="sub">
            Мы отправили 6-значный код на{" "}
            <b>{email}</b>
          </p>

          {err && <div className="error">{err}</div>}

          <div className="field" style={{ textAlign: "center" }}>
            <label style={{ display: "block", marginBottom: 12 }}>Введите код из письма</label>
            <PinInput
              length={6}
              value={code}
              onChange={setCode}
              disabled={busy || expired}
              autoFocus
            />
          </div>

          {!expired ? (
            <div className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: 8 }}>
              Код действует ещё{" "}
              <span style={{ fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>
                {mm}:{ss}
              </span>
            </div>
          ) : (
            <div className="error" style={{ textAlign: "center", marginTop: 8 }}>
              Код истёк —{" "}
              <button type="button" className="btn-link" onClick={onResend}>
                получить новый
              </button>
            </div>
          )}

          <button
            className="primary"
            type="submit"
            disabled={busy || code.length < 6 || expired}
            style={{ width: "100%", marginTop: 16 }}
          >
            {busy && <Spinner />}
            {busy ? "Проверяем..." : "Войти"}
          </button>

          <div className="auth-switch" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn-link" onClick={goBack}>
              ← Другой аккаунт
            </button>
            {resendCooldown > 0 ? (
              <span className="muted" style={{ fontSize: 13 }}>
                Повторно через {resendCooldown} с
              </span>
            ) : (
              <button type="button" className="btn-link" onClick={onResend} disabled={busy}>
                Отправить код повторно
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onCredentials}>
        <h1>Вход</h1>
        <p className="sub">Твой вечер на крыше начинается здесь.</p>
        {err && <div className="error">{err}</div>}
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy && <Spinner />}
          {busy ? "Проверяем..." : "Продолжить →"}
        </button>
        <div className="auth-switch">
          <Link to="/forgot-password">Забыли пароль?</Link>
        </div>
        <div className="auth-switch">
          Нет аккаунта?{" "}
          <Link to={`/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>
            Зарегистрироваться
          </Link>
        </div>
      </form>
    </div>
  );
}
