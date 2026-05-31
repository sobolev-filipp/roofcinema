import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type MessageTemplate,
  type MessageTemplateKind,
  TEMPLATE_KIND_LABELS,
} from "../../api";
import { Skeleton } from "../../components/Loaders";
import { useUI } from "../../ui";

const KIND_ORDER: MessageTemplateKind[] = [
  "manual_booking",
  "pre_booking_info",
  "post_payment",
  "post_show_receipt",
  "payment_reminder",
  "welcome_on_checkin",
  "user_cancel_notice",
  "admin_cancel_screening",
  "refund_link",
  "refund_completed",
  "custom",
];

const PLACEHOLDER_HINTS: Record<string, string> = {
  "{full_name}": "ФИО гостя",
  "{movie}": "Название фильма",
  "{starts_at}": "Дата и время начала показа",
  "{ends_at}": "Дата и время окончания показа (начало + длительность фильма)",
  "{minutes_left}": "Сколько минут осталось до истечения брони (целое число; только для напоминания об оплате)",
  "{rooftop}": "Название крыши",
  "{rooftop_address}": "Точный адрес крыши",
  "{city}": "Город",
  "{expires_at}": "Дедлайн оплаты — до какого времени гость должен оплатить (время создания брони + окно оплаты показа)",
  "{amount}": "Сумма к оплате, ₽",
  "{booking_link}": "Ссылка на страницу брони (требует логина)",
  "{claim_link}": "Магическая ссылка на бронь (без логина, есть QR)",
  "{refund_link}": "Ссылка на форму ввода реквизитов для возврата",
  "{reason}": "Причина отмены (текст вписывает админ)",
  "{short_code}": "6-значный код брони для входа",
  "{qr_image_link}": "QR-код для входа. В письме «После оплаты» вставляется как сама картинка QR (не ссылка). В скопированном тексте для мессенджера — ссылка на картинку с нашего сервера.",
  "{payout_details}": "Реквизиты для оплаты из настроек показа (получатель, номер карты, телефон СБП, банк) — каждый реквизит на отдельной строке",
  "{items}": "Список забронированных мест — тип × количество и сумма, каждая позиция на отдельной строке",
  "{seat_types}": "Список доступных типов мест на выбранном показе — название и цена (без остатка). Каждый тип на отдельной строке. Подставляется при копировании из раздела «+ Бронь вручную».",
};

const KIND_HINTS: Record<MessageTemplateKind, string> = {
  manual_booking: "Текст для отправки пользователю до оплаты. Используйте {expires_at} — дедлайн оплаты, {amount} — сумму, {booking_link} — ссылку на бронь, {rooftop_address} — адрес крыши, {payout_details} — реквизиты оплаты, {items} — список мест, {ends_at} — окончание показа.",
  pre_booking_info: "Сообщение ПЕРЕД ручным бронированием — отправляется пользователю, чтобы он прислал ФИО, email, телефон. Кнопка копирования есть в разделе «+ Бронь вручную». Доступны данные показа: {movie}, {starts_at}, {rooftop}, {city}, {seat_types} — актуальный список доступных типов мест с ценами.",
  post_payment: "Текст после подтверждения оплаты — с QR-кодом и числовым кодом входа. Используйте {short_code} — код входа, {qr_image_link} — ссылку на QR, {rooftop_address} — адрес, {items} — список мест, {ends_at} — окончание показа, {booking_link} — ссылка на бронь в личном кабинете.",
  post_show_receipt: "Текст письма, к которому ПРИКРЕПЛЯЕТСЯ файл чека автоматически (его в тексте указывать не нужно — он уйдёт во вложении). Доступны: {full_name}, {movie}, {starts_at}, {rooftop}, {city}, {items}, {amount}, {booking_link}.",
  payment_reminder: "Напоминание оплатить бронь — отправляется автоматически, когда у пользователя остаётся менее 25% времени. Доступны: {full_name}, {items}, {amount}, {booking_link}, {expires_at}, {minutes_left} — сколько минут осталось, {payout_details} — реквизиты для оплаты, {movie}, {starts_at}, {rooftop}.",
  welcome_on_checkin: "Приветственное письмо после сканирования QR / ввода кода брони на входе. Доступны: {full_name}, {movie}, {starts_at}, {ends_at}, {rooftop}, {rooftop_address}, {city}.",
  user_cancel_notice: "Письмо, которое уйдёт пользователю при отмене его брони.",
  admin_cancel_screening: "Уведомление всем гостям при отмене показа целиком.",
  refund_link: "Сопроводительный текст к ссылке на форму ввода реквизитов для возврата.",
  refund_completed: "Уведомление о выполненном возврате средств — отправляется при отметке «выполнено». Если админ приложил чек о переводе, он уйдёт во вложении автоматически (в тексте указывать не нужно). Доступны: {full_name}, {city}, {movie}, {items}, {amount}.",
  custom: "Произвольные шаблоны на свои нужды.",
};

const EMPTY = { name: "", text: "", is_default: false };

export default function MessageTemplatesAdmin() {
  const { confirm, notify } = useUI();
  const [kind, setKind] = useState<MessageTemplateKind>("manual_booking");
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [placeholders, setPlaceholders] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");

  useEffect(() => {
    api.get<Record<string, string[]>>("/api/admin/message-templates/placeholders")
      .then(setPlaceholders)
      .catch(() => setPlaceholders({}));
  }, []);

  async function reload() {
    setLoading(true); setErr(null);
    try {
      const list = await api.get<MessageTemplate[]>(`/api/admin/message-templates?kind=${kind}`);
      setItems(list);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); resetForm(); }, [kind]); // eslint-disable-line

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY);
  }

  function startEdit(t: MessageTemplate) {
    setEditingId(t.id);
    setForm({ name: t.name, text: t.text, is_default: t.is_default });
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function insertPlaceholder(token: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setForm((f) => ({ ...f, text: f.text + token }));
      return;
    }
    const start = ta.selectionStart ?? form.text.length;
    const end = ta.selectionEnd ?? form.text.length;
    const next = form.text.slice(0, start) + token + form.text.slice(end);
    setForm((f) => ({ ...f, text: next }));
    // вернуть курсор после вставленного токена
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim() || !form.text.trim()) {
      setErr("Заполните название и текст");
      return;
    }
    try {
      if (editingId) {
        await api.patch(`/api/admin/message-templates/${editingId}`, form);
      } else {
        await api.post("/api/admin/message-templates", { kind, ...form });
      }
      resetForm();
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function setDefault(t: MessageTemplate) {
    try { await api.post(`/api/admin/message-templates/${t.id}/set-default`); await reload(); }
    catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }

  async function remove(t: MessageTemplate) {
    const ok = await confirm({
      title: `Удалить шаблон «${t.name}»?`,
      message: "Удаление необратимо. Если он использовался по умолчанию — назначьте default для другого шаблона.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try { await api.del(`/api/admin/message-templates/${t.id}`); if (editingId === t.id) resetForm(); await reload(); }
    catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }

  async function preview() {
    // Демо-контекст из имён плейсхолдеров (значения-заглушки), чтобы увидеть как выглядит результат
    const demo: Record<string, string> = {
      full_name: "Иван Петров",
      movie: "Криминальное чтиво",
      starts_at: "25.05.2026 21:00",
      ends_at: "25.05.2026 23:34",
      expires_at: "25.05.2026 23:59",
      minutes_left: "23",
      rooftop: "Лофт «Небо»",
      rooftop_address: "ул. Ленина, 10, подъезд 2, крыша",
      city: "Томск",
      amount: "1500",
      booking_link: `${window.location.origin}/bookings/123`,
      claim_link: `${window.location.origin}/claim/abc123def`,
      refund_link: `${window.location.origin}/refund/xyz789`,
      reason: "Дождь — показ перенесён",
      payout_details: "Получатель: ИП Крышников А.В.\nКарта: 2200 1234 5678 9012\nТелефон (СБП): +7 999 123-45-67\nБанк: Сбербанк",
      items: "Стандарт ×2 — 3 000 ₽\nVIP ×1 — 2 500 ₽",
      seat_types: "- Стандарт — 1 500 ₽\n- VIP — 2 500 ₽",
    };
    try {
      const res = await api.post<{ rendered: string }>("/api/admin/message-templates/preview", {
        text: form.text,
        context: demo,
      });
      setPreviewText(res.rendered);
      setPreviewOpen(true);
    } catch (e: any) { await notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }

  const availablePlaceholders = useMemo(() => placeholders[kind] ?? [], [placeholders, kind]);

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Шаблоны сообщений</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Используются на разных событиях системы. В тексте можно использовать плейсхолдеры
        <code> {"{...}"} </code> — они подставятся автоматически.
      </p>

      <div className="seg" style={{ marginTop: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {KIND_ORDER.map((k) => (
          <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
            {TEMPLATE_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="hint-box" style={{ marginBottom: 16, fontSize: 13 }}>
        {KIND_HINTS[kind]}
      </div>

      {err && <div className="error">{err}</div>}

      <form onSubmit={submit} className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>{editingId ? "Редактировать шаблон" : "Новый шаблон"}</h3>
        <div className="field">
          <label>Название</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Например: Стандартное приглашение"
            required
          />
        </div>

        <div className="field">
          <label>
            Текст
            {availablePlaceholders.length > 0 && (
              <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                — кликните по плейсхолдеру, чтобы вставить в позицию курсора
              </span>
            )}
          </label>
          {availablePlaceholders.length > 0 && (
            <div className="placeholder-grid">
              {availablePlaceholders.map((ph) => {
                const hint = PLACEHOLDER_HINTS[ph] ?? "";
                return (
                  <button
                    type="button"
                    key={ph}
                    className="placeholder-item"
                    onClick={() => insertPlaceholder(ph)}
                    title={hint ? `${hint}. Клик — вставить.` : `Вставить ${ph}`}
                  >
                    <span className="placeholder-token">{ph}</span>
                    {hint && <span className="placeholder-hint">{hint}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={8}
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            required
            placeholder="Здравствуйте, {full_name}! Мы забронировали вам места на «{movie}» — {starts_at}, {rooftop}. Ссылка: {booking_link}"
            style={{ fontFamily: "monospace", fontSize: 13 }}
          />
        </div>

        <label className="checkbox" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
          />
          <span>По умолчанию для этого типа (будет выбран автоматически)</span>
        </label>

        <div className="row gap" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <button type="submit" className="primary">
            {editingId ? "Сохранить" : "Добавить"}
          </button>
          <button type="button" className="ghost" onClick={preview} disabled={!form.text.trim()}>
            Предпросмотр
          </button>
          {editingId && (
            <button type="button" className="ghost" onClick={resetForm}>Отменить редактирование</button>
          )}
        </div>
      </form>

      <h3>Существующие шаблоны</h3>
      {loading ? (
        <Skeleton variant="row" count={3} />
      ) : items.length === 0 ? (
        <div className="empty">Шаблонов этого типа ещё нет. Добавьте первый.</div>
      ) : (
        <div className="templates-list">
          {items.map((t) => (
            <div key={t.id} className={"card template-card" + (t.is_default ? " template-default" : "")}>
              <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {t.name}
                    {t.is_default && <span className="badge accent" style={{ marginLeft: 8 }}>по умолчанию</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    обновлён {new Date(t.updated_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
                <div className="row gap" style={{ flexShrink: 0 }}>
                  {!t.is_default && (
                    <button className="ghost" onClick={() => setDefault(t)}>Сделать по умолчанию</button>
                  )}
                  <button className="ghost" onClick={() => startEdit(t)}>Редактировать</button>
                  <button className="ghost danger-on-hover" onClick={() => remove(t)}>✕</button>
                </div>
              </div>
              <pre className="template-preview" style={{ marginTop: 10 }}>{t.text}</pre>
            </div>
          ))}
        </div>
      )}

      {previewOpen && (
        <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={() => setPreviewOpen(false)}>
          <div className="ui-dialog" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-dialog-title">Предпросмотр (с демо-значениями)</h3>
            <pre className="template-preview" style={{ marginTop: 8, maxHeight: "60vh" }}>{previewText}</pre>
            <div className="ui-dialog-actions">
              <button type="button" className="primary" onClick={() => setPreviewOpen(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
