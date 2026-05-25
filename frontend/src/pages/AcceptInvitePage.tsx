import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Rooftop } from "../api";
import { useAuth } from "../auth";

export default function AcceptInvitePage() {
  const { token } = useParams();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [state, setState] = useState<"idle" | "accepting" | "done" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [roof, setRoof] = useState<Rooftop | null>(null);

  async function accept() {
    setState("accepting");
    setErr(null);
    try {
      const r = await api.post<Rooftop>(`/api/rooftops/invites/${token}/accept`);
      setRoof(r);
      await refresh();
      setState("done");
    } catch (e: any) {
      setErr(e.message);
      setState("error");
    }
  }

  useEffect(() => { accept(); }, [token]); // eslint-disable-line

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <h1>Приглашение администратора</h1>
      <div className="card" style={{ marginTop: 16 }}>
        {state === "accepting" && <p className="muted">Принимаем приглашение...</p>}
        {state === "error" && <div className="error">{err}</div>}
        {state === "done" && roof && (
          <>
            <p>Вы добавлены как администратор крыши <b>{roof.name}</b>.</p>
            <button className="primary" onClick={() => nav("/")}>На главную</button>
          </>
        )}
      </div>
    </div>
  );
}
