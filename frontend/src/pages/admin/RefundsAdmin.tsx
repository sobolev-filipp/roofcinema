import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RefundRequest, type RefundRequestStatus } from "../../api";
import { Skeleton } from "../../components/Loaders";
import { useUI } from "../../ui";

type Tab = RefundRequestStatus;

const TAB_LABEL: Record<Tab, string> = {
  created: "Создано (ждём реквизитов)",
  filled: "Реквизиты получены",
  completed: "Возвраты выполнены",
};

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : "—";

type FillForm = {
  fullName: string;
  card: string;
  bank: string;
  comment: string;
};

const emptyForm = (): FillForm => ({ fullName: "", card: "", bank: "", comment: "" });

export default function RefundsAdmin() {
  const { confirm, notify } = useUI();
  const [tab, setTab] = useState<Tab>("filled");
  const [items, setItems] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Инлайн-форма ручного ввода реквизитов
  const [fillId, setFillId] = useState<number | null>(null);   // id карточки с открытой формой
  const [fillForm, setFillForm] = useState<FillForm>(emptyForm());

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

  function openFillForm(r: RefundRequest) {
    // Предзаполняем уже имеющимися реквизитами (если есть)
    setFillForm({
      fullName: r.payout_full_name ?? "",
      card: r.payout_card_or_sbp ?? "",
      bank: r.payout_bank ?? "",
      comment: r.payout_comment ?? "",
    });
    setFillId(r.id);
  }

  function closeFillForm() {
    setFillId(null);
    setFillForm(emptyForm());
  }

  async function submitFill(r: RefundRequest) {
    if (!fillForm.fullName.trim() || !fillForm.card.trim()) {
      await notify({ title: "Заполните поля", message: "ФИО и карта/СБП обязательны.", kind: "error" });
      return;
    }
    setBusyId(r.id);
    try {
      await api.post(`/api/admin/refund-requests/${r.id}/fill`, {
        payout_full_name: fillForm.fullName.trim(),
        payout_card_or_sbp: fillForm.card.trim(),
        payout_bank: fillForm.bank.trim() || null,
        payout_comment: fillForm.comment.trim() || null,
      });
      closeFillForm();
      await reload();
      await notify({ title: "Готово", message: "Реквизиты сохранены. Запрос перемещён во вкладку «Реквизиты получены».", kind: "success" });
    } catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
    finally { setBusyId(null); }
  }

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Возвраты средств</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Запросы возврата создаются автоматически при отмене оплаченной брони.
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
        <Skeleton variant="row" count={4} />
      ) : items.length === 0 ? (
        <div className="empty">Нет запросов в этой вкладке.</div>
      ) : (
        <div className="refunds-list">
          {items.map((r) => (
            <div key={r.id} className="card refund-card">
              <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
                {/* ── Левая колонка: инфо ── */}
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

                {/* ── Правая колонка: кнопки ── */}
                <div className="row gap" style={{ flexDirection: "column", alignItems: "stretch", minWidth: 200 }}>
                  <button className="ghost" onClick={() => copyLink(r)}>
                    {copied === r.id ? "✓ Скопировано" : "📋 Скопировать ссылку"}
                  </button>
                  {tab !== "completed" && (
                    <button className="ghost" onClick={() => resend(r)} disabled={busyId === r.id}>
                      ↻ Отправить ссылку на email
                    </button>
                  )}
                  {tab !== "completed" && (
                    <button
                      className="ghost"
                      onClick={() => fillId === r.id ? closeFillForm() : openFillForm(r)}
                      disabled={busyId === r.id}
                    >
                      ✏️ {fillId === r.id ? "Закрыть форму" : "Ввести реквизиты вручную"}
                    </button>
                  )}
                  {tab === "filled" && (
                    <button className="primary" onClick={() => markCompleted(r)} disabled={busyId === r.id}>
                      Пометить как выполненный
                    </button>
                  )}
                </div>
              </div>

              {/* ── Реквизиты от пользователя (если уже есть) ── */}
              {!fillId || fillId !== r.id ? (
                (r.payout_full_name || r.payout_card_or_sbp || r.payout_bank || r.payout_comment) && (
                  <div className="hint-box" style={{ marginTop: 12, fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Реквизиты:</div>
                    {r.payout_full_name && <div><b>ФИО:</b> {r.payout_full_name}</div>}
                    {r.payout_card_or_sbp && <div><b>Карта / СБП:</b> <code>{r.payout_card_or_sbp}</code></div>}
                    {r.payout_bank && <div><b>Банк:</b> {r.payout_bank}</div>}
                    {r.payout_comment && <div style={{ marginTop: 4 }}><b>Комментарий:</b> {r.payout_comment}</div>}
                  </div>
                )
              ) : (
                /* ── Инлайн-форма ручного ввода ── */
                <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                    Введите реквизиты за пользователя — они сохранятся и запрос перейдёт в статус «реквизиты получены».
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>ФИО получателя *</label>
                      <input
                        value={fillForm.fullName}
                        onChange={(e) => setFillForm({ ...fillForm, fullName: e.target.value })}
                        placeholder="Иванов Иван Иванович"
                      />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Карта или телефон СБП *</label>
                      <input
                        value={fillForm.card}
                        onChange={(e) => setFillForm({ ...fillForm, card: e.target.value })}
                        placeholder="2200 1234 5678 9012 или +7 999..."
                      />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Банк (необязательно)</label>
                      <input
                        value={fillForm.bank}
                        onChange={(e) => setFillForm({ ...fillForm, bank: e.target.value })}
                        placeholder="Сбербанк, Тинькофф..."
                      />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Комментарий (необязательно)</label>
                      <input
                        value={fillForm.comment}
                        onChange={(e) => setFillForm({ ...fillForm, comment: e.target.value })}
                        placeholder="Например: переводить на СБП"
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button className="ghost" onClick={closeFillForm}>Отмена</button>
                    <button
                      className="primary"
                      onClick={() => submitFill(r)}
                      disabled={busyId === r.id}
                    >
                      {busyId === r.id ? "Сохраняем..." : "Сохранить реквизиты"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
