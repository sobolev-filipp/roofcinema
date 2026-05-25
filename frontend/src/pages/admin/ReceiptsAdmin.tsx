import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PaymentReceiptAdmin } from "../../api";

type Tab = "pending" | "approved" | "rejected";

const TAB_LABEL: Record<Tab, string> = {
  pending: "На проверке",
  approved: "Подтверждённые",
  rejected: "Отклонённые",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

export default function ReceiptsAdmin() {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<PaymentReceiptAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function reload() {
    setLoading(true);
    setErr(null);
    try {
      const list = await api.get<PaymentReceiptAdmin[]>(`/api/admin/receipts?status=${tab}`);
      setItems(list);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, [tab]); // eslint-disable-line

  async function approve(r: PaymentReceiptAdmin) {
    if (!window.confirm(`Подтвердить оплату по брони #${r.booking_id} на ${Number(r.booking_total_amount).toFixed(0)} ₽?`)) return;
    setBusyId(r.id);
    try {
      await api.post(`/api/admin/receipts/${r.id}/approve`);
      await reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(r: PaymentReceiptAdmin) {
    const reason = window.prompt(
      `Причина отказа по брони #${r.booking_id}:\n(текст увидит пользователь в письме и на странице брони)`,
      "",
    );
    if (!reason || !reason.trim()) return;
    setBusyId(r.id);
    try {
      await api.post(`/api/admin/receipts/${r.id}/reject`, { reason: reason.trim() });
      await reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Чеки об оплате</h2>

      <div className="seg" style={{ marginTop: 12, marginBottom: 16 }}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? (
        <div className="empty">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="empty">Чеков в этой вкладке нет.</div>
      ) : (
        <div className="receipts-grid">
          {items.map((r) => (
            <div key={r.id} className="card receipt-card">
              <div className="receipt-thumb">
                <a href={r.image_url} target="_blank" rel="noreferrer">
                  {r.image_url.toLowerCase().endsWith(".pdf") ? (
                    <div className="pdf-thumb">PDF<br /><span className="muted" style={{ fontSize: 12 }}>открыть ↗</span></div>
                  ) : (
                    <img src={r.image_url} alt="чек" />
                  )}
                </a>
              </div>

              <div className="receipt-meta">
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  <Link to={`/bookings/${r.booking_id}`} className="rooftop-link">
                    #{r.booking_id} · {r.booking_full_name}
                  </Link>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{r.booking_email}</div>
                <div style={{ marginTop: 8, fontSize: 14 }}>
                  <b>{r.movie_title}</b>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {fmt(r.screening_starts_at)} · {r.rooftop_name}
                </div>
                <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700 }}>
                  {Number(r.booking_total_amount).toFixed(0)} ₽
                  {Number(r.booking_balance_used) > 0 && (
                    <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                      (с баланса: {Number(r.booking_balance_used).toFixed(0)})
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Загружен {fmt(r.uploaded_at)}
                </div>
                {r.amount_claimed != null && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Заявлено пользователем: {Number(r.amount_claimed).toFixed(0)} ₽
                  </div>
                )}
                {r.rejection_reason && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <b>Причина отказа:</b> {r.rejection_reason}
                  </div>
                )}

                {tab === "pending" && (
                  <div className="row gap" style={{ marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      className="primary"
                      onClick={() => approve(r)}
                      disabled={busyId === r.id}
                    >
                      Подтвердить
                    </button>
                    <button
                      className="ghost danger-on-hover"
                      onClick={() => reject(r)}
                      disabled={busyId === r.id}
                    >
                      Отклонить
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
