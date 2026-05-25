import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type RefundClaim } from "../api";
import { useUI } from "../ui";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

export default function RefundPage() {
  const { token } = useParams();
  const { notify } = useUI();
  const [info, setInfo] = useState<RefundClaim | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [card, setCard] = useState("");
  const [bank, setBank] = useState("");
  const [comment, setComment] = useState("");

  async function load() {
    setErr(null);
    try {
      const data = await api.get<RefundClaim>(`/api/refund/${token}`);
      setInfo(data);
      setFullName(data.payout_full_name ?? "");
      setCard(data.payout_card_or_sbp ?? "");
      setBank(data.payout_bank ?? "");
      setComment(data.payout_comment ?? "");
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !card.trim()) {
      await notify({ title: "Заполните поля", message: "Нужны ФИО и номер карты или телефон СБП.", kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const data = await api.post<RefundClaim>(`/api/refund/${token}/submit`, {
        payout_full_name: fullName.trim(),
        payout_card_or_sbp: card.trim(),
        payout_bank: bank.trim() || null,
        payout_comment: comment.trim() || null,
      });
      setInfo(data);
      await notify({
        title: "Реквизиты отправлены",
        message: "Организатор переведёт деньги вручную. После перевода вы получите уведомление.",
        kind: "success",
      });
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (err && !info) {
    return (
      <div className="container" style={{ maxWidth: 560 }}>
        <div className="error" style={{ marginTop: 24 }}>{err}</div>
        <Link to="/" className="ghost btn-as-link" style={{ display: "inline-block", marginTop: 16 }}>← На главную</Link>
      </div>
    );
  }
  if (!info) return <div className="container"><div className="empty">Загрузка...</div></div>;

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <div className="card" style={{ marginTop: 24 }}>
        <h1 style={{ marginTop: 0 }}>Возврат средств</h1>
        <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>
          По отменённой брони на показ <b>{info.movie_title}</b> ({fmt(info.screening_starts_at)}, {info.rooftop_name}).
          Бронирующий: {info.main_booker_name}.
        </p>
        <div className="stat-card" style={{ marginBottom: 12 }}>
          <div className="stat-label">Сумма к возврату</div>
          <div className="stat-value">{Number(info.amount).toFixed(0)} <span style={{ fontSize: 16 }}>₽</span></div>
        </div>

        {info.status === "completed" ? (
          <div className="hint-box">
            <b>✅ Возврат выполнен{info.completed_at ? ` ${fmt(info.completed_at)}` : ""}.</b>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Если средства не пришли — свяжитесь с организатором.
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            {info.status === "filled" && (
              <div className="hint-box" style={{ marginBottom: 12 }}>
                Реквизиты получены, ждём перевода от организатора. Если что-то поменялось — обновите поля и сохраните.
              </div>
            )}
            <div className="field">
              <label>ФИО получателя *</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Номер карты или телефон для СБП *</label>
              <input
                value={card}
                onChange={(e) => setCard(e.target.value)}
                placeholder="2200 1234 5678 9012  или  +7 999 ..."
                required
              />
              <span className="muted" style={{ fontSize: 11 }}>
                Можно указать что-то одно. Эти данные увидит только организатор.
              </span>
            </div>
            <div className="field">
              <label>Банк (необязательно)</label>
              <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Сбербанк, Тинькофф..." />
            </div>
            <div className="field">
              <label>Комментарий (необязательно)</label>
              <textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: переводите на СБП, на карту нельзя"
              />
            </div>
            <button type="submit" className="primary" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Отправляем..." : info.status === "filled" ? "Обновить реквизиты" : "Отправить реквизиты"}
            </button>
          </form>
        )}

        <p className="muted" style={{ fontSize: 11, marginTop: 16, textAlign: "center" }}>
          Сохраните эту ссылку — по ней можно следить за статусом возврата.
        </p>
      </div>
    </div>
  );
}
