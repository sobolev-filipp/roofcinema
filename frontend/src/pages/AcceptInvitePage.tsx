import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type Rooftop } from "../api";
import { useAuth } from "../auth";

export default function AcceptInvitePage() {
  const { token } = useParams();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [state, setState] = useState<"idle" | "accepting" | "done" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [roof, setRoof] = useState<Rooftop | null>(null);
  // защита от двойного вызова в React.StrictMode (в dev-режиме useEffect
  // выполняется дважды — второй вызов получает «уже использовано» и портит UI).
  const startedRef = useRef(false);

  async function accept() {
    setState("accepting");
    setErr(null);
    try {
      const r = await api.post<Rooftop>(`/api/rooftops/invites/${token}/accept`);
      setRoof(r);
      await refresh();
      setState("done");
    } catch (e: any) {
      // если приглашение уже принято — значит первый вызов (или предыдущий заход)
      // успешно отработал; обновим юзера и покажем success, а не ошибку.
      if (e instanceof ApiError && e.status === 400 && /уже использовано/i.test(e.message)) {
        await refresh();
        setState("done");
        return;
      }
      setErr(e.message);
      setState("error");
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    accept();
  }, [token]); // eslint-disable-line

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <h1>Приглашение администратора</h1>
      <div className="card" style={{ marginTop: 16 }}>
        {state === "accepting" && <p className="muted">Принимаем приглашение...</p>}
        {state === "error" && <div className="error">{err}</div>}
        {state === "done" && (
          <>
            <p>
              ✅ Вы добавлены как администратор крыши{" "}
              <b>{roof?.name ?? "(данные обновляются)"}</b>.
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Теперь у вас доступна админ-панель: бронирования, чеки, ручное бронирование и т.д.
            </p>
            <div className="row gap" style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => nav("/admin/bookings")}>
                Открыть админ-панель →
              </button>
              <button className="ghost" onClick={() => nav("/")}>На главную</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
