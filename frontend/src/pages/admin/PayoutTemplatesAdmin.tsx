import { useEffect, useState } from "react";
import { api, type PayoutTemplate } from "../../api";
import { useUI } from "../../ui";

const empty = {
  name: "", recipient_name: "", card_number: "", phone: "", bank_name: "", note: "", is_default: false,
};

export default function PayoutTemplatesAdmin() {
  const { confirm } = useUI();
  const [list, setList] = useState<PayoutTemplate[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try { setList(await api.get<PayoutTemplate[]>("/api/payout-templates")); } catch {}
  }
  useEffect(() => { reload(); }, []);

  function startEdit(t: PayoutTemplate) {
    setEditingId(t.id);
    setForm({
      name: t.name, recipient_name: t.recipient_name, card_number: t.card_number ?? "",
      phone: t.phone ?? "", bank_name: t.bank_name ?? "", note: t.note ?? "", is_default: t.is_default,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function resetForm() { setEditingId(null); setForm(empty); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const payload = {
      ...form,
      card_number: form.card_number || null,
      phone: form.phone || null,
      bank_name: form.bank_name || null,
      note: form.note || null,
    };
    try {
      if (editingId) await api.patch(`/api/payout-templates/${editingId}`, payload);
      else await api.post("/api/payout-templates", payload);
      resetForm();
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function del(t: PayoutTemplate) {
    if (!await confirm({ title: "Удалить шаблон?", message: `«${t.name}» — действие необратимо.`, confirmText: "Удалить", danger: true })) return;
    try { await api.del(`/api/payout-templates/${t.id}`); await reload(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Шаблоны реквизитов оплаты</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Эти реквизиты будут показаны пользователю при оплате брони переводом.
        Один шаблон можно сделать «по умолчанию» — он подставится при создании новых показов.
      </p>

      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}

      <form onSubmit={submit} className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{editingId ? "Редактировать шаблон" : "Новый шаблон"}</h3>
        <div className="row gap" style={{ flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Название шаблона</label>
            <input required placeholder="Карта Сбербанк" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>ФИО получателя</label>
            <input required value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} />
          </div>
        </div>
        <div className="row gap" style={{ flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Номер карты (16 цифр)</label>
            <input
              inputMode="numeric"
              placeholder="2200 1234 5678 9012"
              value={form.card_number}
              onChange={(e) => setForm({ ...form, card_number: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>Телефон для СБП</label>
            <input placeholder="+7 999 123-45-67" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>Банк</label>
            <input placeholder="Сбербанк" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Комментарий (необязательно)</label>
          <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <label className="checkbox" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
          <span>Использовать по умолчанию для новых показов</span>
        </label>
        <div className="row gap" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          {editingId && <button type="button" className="ghost" onClick={resetForm}>Отмена</button>}
          <button className="primary" type="submit">{editingId ? "Сохранить" : "Добавить"}</button>
        </div>
      </form>

      <div className="cards-grid" style={{ marginTop: 16 }}>
        {list.map((t) => (
          <div key={t.id} className="card">
            <div className="row between">
              <h3 style={{ margin: 0, fontSize: 16 }}>{t.name}</h3>
              {t.is_default && <span className="badge accent">по умолчанию</span>}
            </div>
            <div className="meta">{t.recipient_name}</div>
            {t.card_number && <div style={{ fontFamily: "monospace", marginTop: 6 }}>{t.card_number}</div>}
            {t.phone && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t.phone}{t.bank_name ? ` · ${t.bank_name}` : ""}</div>}
            <div className="row gap" style={{ marginTop: 10 }}>
              <button onClick={() => startEdit(t)}>Редактировать</button>
              <button className="ghost danger-on-hover" onClick={() => del(t)}>Удалить</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="empty">Шаблонов пока нет.</div>}
      </div>
    </div>
  );
}
