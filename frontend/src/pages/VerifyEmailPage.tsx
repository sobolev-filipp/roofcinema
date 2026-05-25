import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import PinInput from "../components/PinInput";

export default function VerifyEmailPage() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState<number>(0);

  async function refreshStatus() {
    try {
      const s = await api.get<{ verified: boolean; can_resend_in: number }>("/api/auth/verify-email/status");
      if (s.verified) {
        await refresh();
        nav("/profile", { replace: true });
        return;
      }
      setResendIn(s.can_resend_in || 0);
    } catch {}
  }
  useEffect(() => { refreshStatus(); }, []); // eslint-disable-line

  // тикер отсчёта
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  async function submit(value: string) {
    setBusy(true); setErr(null);
    try {
      await api.post("/api/auth/verify-email/confirm", { code: value });
      await refresh();
      setInfo("Email подтверждён!");
      setTimeout(() => nav("/profile", { replace: true }), 700);
    } catch (e: any) {
      setErr(e.message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setErr(null); setInfo(null); setBusy(true);
    try {
      const r = await api.post<{ next_resend_after_seconds: number }>("/api/auth/verify-email/send");
      setResendIn(r.next_resend_after_seconds || 60);
      setInfo(`Новый код отправлен на ${user?.email}`);
    } catch (e: any) {
      setErr(e.message);
      // вытащим cooldown из текста
      const m = e.message?.match(/(\d+)/);
      if (m) setResendIn(parseInt(m[1], 10));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 460 }}>
      <h1 style={{ marginTop: 16 }}>Подтверждение email</h1>
      <p className="muted" style={{ fontSize: 14 }}>
        Мы отправили 6-значный код на <b style={{ color: "var(--text)" }}>{user?.email}</b>.
        Введите его, чтобы подтвердить адрес.
      </p>

      {err && <div className="error">{err}</div>}
      {info && <div className="hint-box" style={{ marginBottom: 12 }}>{info}</div>}

      <div className="card">
        <PinInput
          length={6}
          value={code}
          onChange={setCode}
          autoFocus
          disabled={busy}
          onComplete={submit}
        />
        <button
          className="primary btn-block"
          style={{ marginTop: 16 }}
          disabled={busy || code.length !== 6}
          onClick={() => submit(code)}
        >
          {busy ? "Проверяем..." : "Подтвердить"}
        </button>

        <div className="resend-row">
          {resendIn > 0 ? (
            <span className="muted">Запросить новый код через <b style={{ color: "var(--text)" }}>{resendIn}с</b></span>
          ) : (
            <button type="button" className="ghost btn-sm" onClick={resend} disabled={busy}>
              Отправить код повторно
            </button>
          )}
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Не приходит письмо? Проверьте папку «Спам». Если SMTP не настроен — посмотрите консоль backend
        (там код виден с пометкой <code>[DEV-EMAIL]</code>).
      </p>
    </div>
  );
}
