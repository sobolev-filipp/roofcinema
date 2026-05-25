import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RefundRequest, type RefundRequestStatus } from "../../api";
import { useUI } from "../../ui";

type Tab = RefundRequestStatus;

const TAB_LABEL: Record<Tab, string> = {
  created: "Создано (ждём ввода реквизитов)",
  filled: "Реквизиты получены",
  completed: "Возвраты выполнены",
};

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function RefundsAdmin() {
  const { confirm, notify } = useUI();
  const [tab, setTab] = useState<Tab>("filled");
  const [items, setItems] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function reload() {
    setLoading(true); setErr(null);
    try {
      const list = await api.get<RefundRequest[]>(`/api/admin/refund-requests?status=${tab}`);
      setItems(list);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [tab]); // eslint-disable-line

  function copyLink(r: RefundRequest) {
    navigator.clipboard.writeText(r.payout_url).then(
      () => { setCopied(r.id); setTimeout(() => setCopied(null), 2000); },
      () => notify({ title: "Не удалось скопировать", message: "Браузер запретил доступ к буферу.", kind: "error" }),
    );
  }

  async function resend(r: RefundRequest) {
    setBusyId(r.id);
    try {
      await api.post(`/api/admin/refund-requests/${r.id}/send-link`);
      await notify({ title: "Готово", message: "Ссылка отправлена повторно на email пользователя.", kind: "success" });
      await reload();
    } catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
    finally { setBusyId(null); }
  }

  async function markCompleted(r: RefundRequest) {
    const ok = await confirm({
      title: "Перевод выполнен?",
      message: `Подтвердите, что вы вручную перевели ${Number(r.amount).toFixed(0)} ₽ пользователю ${r.booking_full_name}. После этого запрос станет «выполнен» и не появится в активных.`,
      confirmText: "Да, перевод выполнен",
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      await api.post(`/api/admin/refund-requests/${r.id}/mark-completed`);
      await reload();
    } catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Возвраты средств</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Запросы возврата создаются из «Бронирований» (вкладка «Завершённые» → отменённая бронь → «запросить возврат денег»).
      </p>

      <div className="seg" style={{ marginTop: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? (
        <div className="empty">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="empty">Нет запросов в этой вкладке.</div>
      ) : (
        <div className="refunds-list">
          {items.map((r) => (
            <div key={r.id} className="card refund-card">
              <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    <Link to={`/bookings/${r.booking_id}`} className="rooftop-link">
                      #{r.booking_id} · {r.booking_full_name}
                    </Link>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{r.booking_email}</div>
                  <div style={{ marginTop: 6, fontSize: 14 }}>
                    {r.movie_title}{r.screening_starts_at ? ` · ${fmt(r.screening_starts_at)}` : ""} · {r.rooftop_name}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700 }}>
                    {Number(r.amount).toFixed(0)} ₽
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    создан {fmt(r.created_at)}
                    {r.link_sent_at && ` · ссылка ушла ${fmt(r.link_sent_at)}`}
                    {r.filled_at && ` · реквизиты ${fmt(r.filled_at)}`}
                    {r.completed_at && ` · выполнен ${fmt(r.completed_at)}`}
                  </div>
                </div>

                <div className="row gap" style={{ flexDirection: "column", alignItems: "stretch", minWidth: 200 }}>
                  <button className="ghost" onClick={() => copyLink(r)}>
                    {copied === r.id ? "✓ Скопировано" : "📋 Скопировать ссылку"}
                  </button>
                  {tab !== "completed" && (
                    <button className="ghost" onClick={() => resend(r)} disabled={busyId === r.id}>
                      ↻ Отправить ссылку на email
                    </button>
                  )}
                  {tab === "filled" && (
                    <button className="primary" onClick={() => markCompleted(r)} disabled={busyId === r.id}>
                      Пометить как выполненный
                    </button>
                  )}
                </div>
              </div>

              {(r.payout_full_name || r.payout_card_or_sbp || r.payout_bank || r.payout_comment) && (
                <div className="hint-box" style={{ marginTop: 12, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Реквизиты от пользователя:</div>
                  {r.payout_full_name && <div><b>ФИО:</b> {r.payout_full_name}</div>}
                  {r.payout_card_or_sbp && <div><b>Карта / СБП:</b> <code>{r.payout_card_or_sbp}</code></div>}
                  {r.payout_bank && <div><b>Банк:</b> {r.payout_bank}</div>}
                  {r.payout_comment && (
                    <div style={{ marginTop: 4 }}><b>Комментарий:</b> {r.payout_comment}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
