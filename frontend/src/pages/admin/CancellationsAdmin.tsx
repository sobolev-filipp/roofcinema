import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Screening } from "../../api";
import { Skeleton, Spinner } from "../../components/Loaders";
import { useUI } from "../../ui";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

/** Бронь, ожидающая решения после отмены показа (форма из /api/admin/cancellations). */
type CancelItem = {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  short_code: string;
  status: string;
  total_amount: number;
  balance_used: number;
  items: { name: string; qty: number; price_each: number }[];
  screening: {
    id: number | null;
    starts_at: string | null;
    movie_title: string | null;
    rooftop_name: string | null;
    city_name: string | null;
  } | null;
};

function isActiveScreening(s: Screening) {
  return s.is_active && !s.cancelled_at && new Date(s.starts_at).getTime() > Date.now();
}

export default function CancellationsAdmin() {
  const { confirm, notify } = useUI();
  const [items, setItems] = useState<CancelItem[]>([]);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [transferFor, setTransferFor] = useState<{ item: CancelItem; target: number | null } | null>(null);

  async function reload() {
    try {
      const list = await api.get<CancelItem[]>("/api/admin/cancellations");
      setItems(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.get<Screening[]>("/api/screenings?include_inactive=true").then(setScreenings).catch(() => {});
    void reload();
  }, []);

  // Real-time: обновляем раз в 10с и при возврате на вкладку
  useEffect(() => {
    const t = setInterval(() => { void reload(); }, 10_000);
    const onVis = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const transferTargets = useMemo(
    () => screenings.filter(isActiveScreening),
    [screenings],
  );

  async function refundToBalance(it: CancelItem) {
    const ok = await confirm({
      title: "Вернуть на баланс?",
      message: `${Number(it.total_amount).toFixed(0)} ₽ зачислятся на баланс ${it.email}. Деньги станут доступны в его аккаунте (по этой почте).`,
      confirmText: "Вернуть на баланс",
    });
    if (!ok) return;
    setBusyId(it.id);
    try {
      await api.post(`/api/bookings/${it.id}/refund-to-balance`);
      await reload();
    } catch (e: any) {
      await notify({ title: "Ошибка", message: e.message, kind: "error" });
    } finally { setBusyId(null); }
  }

  async function moneyRefund(it: CancelItem) {
    const ok = await confirm({
      title: "Запросить возврат средств?",
      message: `Пользователю ${it.full_name} (${it.email}) уйдёт письмо со ссылкой на форму реквизитов. После заполнения возврат появится в разделе «Возвраты».`,
      confirmText: "Создать запрос",
    });
    if (!ok) return;
    setBusyId(it.id);
    try {
      await api.post(`/api/admin/bookings/${it.id}/refund-request`);
      await reload();
      await notify({ title: "Готово", message: "Запрос на возврат создан, ссылка отправлена.", kind: "success" });
    } catch (e: any) {
      await notify({ title: "Ошибка", message: e.message, kind: "error" });
    } finally { setBusyId(null); }
  }

  async function submitTransfer() {
    if (!transferFor || !transferFor.target) return;
    const { item, target } = transferFor;
    setBusyId(item.id);
    setTransferFor(null);
    try {
      await api.post(`/api/bookings/${item.id}/transfer?target_screening_id=${target}`);
      await reload();
      await notify({ title: "Перенесено", message: "Бронь перенесена на другой показ.", kind: "success" });
    } catch (e: any) {
      await notify({ title: "Ошибка переноса", message: e.message, kind: "error" });
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Отмена показа</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Брони с отменённых показов. По каждой выберите: перенести на другой показ,
        вернуть деньги на баланс или оформить возврат средств.
      </p>

      {loading ? (
        <Skeleton variant="row" count={3} />
      ) : items.length === 0 ? (
        <div className="empty">Нет броней, ожидающих решения.</div>
      ) : (
        <div className="receipts-grid">
          {items.map((it) => {
            const isBusy = busyId === it.id;
            return (
              <div key={it.id} className="card receipt-card">
                <div className="receipt-meta" style={{ padding: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    <Link to={`/bookings/${it.id}`} className="rooftop-link">
                      #{it.id} · {it.full_name}
                    </Link>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {it.email}{it.phone ? ` · ${it.phone}` : ""}
                  </div>
                  {it.screening?.movie_title && (
                    <>
                      <div style={{ marginTop: 8, fontSize: 14 }}><b>{it.screening.movie_title}</b></div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {it.screening.starts_at && fmt(it.screening.starts_at)} · {it.screening.rooftop_name}
                        {it.screening.city_name && `, ${it.screening.city_name}`}
                      </div>
                    </>
                  )}
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    {it.items.map((x, i) => (
                      <div key={i}>
                        {x.name} ×{x.qty}
                        <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                          {(x.qty * x.price_each).toFixed(0)} ₽
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700 }}>
                    {Number(it.total_amount).toFixed(0)} ₽
                    {Number(it.balance_used) > 0 && (
                      <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                        (с баланса: {Number(it.balance_used).toFixed(0)})
                      </span>
                    )}
                  </div>

                  <div className="cancel-actions" style={{ marginTop: 12 }}>
                    <button
                      onClick={() => setTransferFor({ item: it, target: null })}
                      disabled={isBusy}
                    >
                      Перенести
                    </button>
                    <button onClick={() => refundToBalance(it)} disabled={isBusy}>
                      {isBusy && <Spinner />}→ на баланс
                    </button>
                    <button className="primary" onClick={() => moneyRefund(it)} disabled={isBusy}>
                      Возврат средств
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {transferFor && (
        <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={() => setTransferFor(null)}>
          <div className="ui-dialog" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-dialog-title">Перенести бронь</h3>
            <div className="ui-dialog-body">
              {transferFor.item.full_name} — на какой показ перенести? Сохранятся типы мест по
              именам и уплаченная цена.
            </div>
            <select
              autoFocus
              value={transferFor.target ?? ""}
              onChange={(e) => setTransferFor({ item: transferFor.item, target: e.target.value ? Number(e.target.value) : null })}
              style={{ marginTop: 12, width: "100%" }}
            >
              <option value="">— выбрать показ —</option>
              {transferTargets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.movie.title} · {fmt(s.starts_at)} · {s.rooftop.name}
                </option>
              ))}
            </select>
            <div className="ui-dialog-actions">
              <button type="button" className="ghost" onClick={() => setTransferFor(null)}>Отмена</button>
              <button type="button" className="primary" onClick={submitTransfer} disabled={!transferFor.target}>
                Перенести
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
