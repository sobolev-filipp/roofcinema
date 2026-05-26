import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type City, type Rooftop, type SeatType } from "../../api";
import Autocomplete from "../../components/Autocomplete";
import { useUI } from "../../ui";

type AddressSuggestion = { address: string; lat: number; lng: number; display: string; full_display: string };
type InviteOut = {
  id: number; rooftop_id: number; token: string;
  expires_at: string; accepted_at: string | null; revoked_at: string | null;
  permissions: string[] | null; target_rooftop_ids: number[] | null; created_at: string;
};

const PERM_OPTIONS: { value: string; label: string }[] = [
  { value: "manage_rooftops",         label: "Редактировать крыши" },
  { value: "manage_movies",           label: "Добавлять / редактировать фильмы" },
  { value: "manage_screenings",       label: "Создавать / редактировать показы" },
  { value: "manage_bookings",         label: "Работать с бронированиями" },
  { value: "manage_transfers",        label: "Переносить брони" },
  { value: "manage_cancellations",    label: "Отменять брони" },
  { value: "manual_booking",          label: "Добавлять брони вручную" },
  { value: "manage_receipts",         label: "Проверять чеки" },
  { value: "manage_refunds",          label: "Работать с возвратами" },
  { value: "manage_payout_templates", label: "Управлять реквизитами" },
  { value: "manage_templates",        label: "Редактировать шаблоны сообщений" },
  { value: "check_in",                label: "Раздел «Вход» (QR-сканер)" },
  { value: "view_statistics",         label: "Смотреть статистику" },
];

export default function RooftopAdmin() {
  const { confirm } = useUI();
  const { id } = useParams();
  const rooftopId = Number(id);
  const nav = useNavigate();
  const [cities, setCities] = useState<City[]>([]);
  const [rooftop, setRooftop] = useState<Rooftop | null>(null);
  const [allRooftops, setAllRooftops] = useState<Rooftop[]>([]);
  const [form, setForm] = useState({ name: "", address: "", description: "", lat: null as number | null, lng: null as number | null });
  const [seatTypes, setSeatTypes] = useState<SeatType[]>([]);
  const [newSt, setNewSt] = useState({ name: "", default_price: 0, default_count: 0, capacity: 1 });
  const [invites, setInvites] = useState<InviteOut[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Создание приглашения: открытая панель с чекбоксами прав
  const [showInviteForm, setShowInviteForm] = useState(false);
  // null = все права (full access); [] = конкретный список (пустой по умолчанию)
  const [invitePerms, setInvitePerms] = useState<string[] | null>(null);
  // Дополнительные крыши для приглашения (текущая всегда включена)
  const [inviteExtraRooftopIds, setInviteExtraRooftopIds] = useState<number[]>([]);

  async function reload() {
    const [cs, all, st, iv] = await Promise.all([
      api.get<City[]>("/api/cities?active_only=false"),
      api.get<Rooftop[]>("/api/rooftops?active_only=false"),
      api.get<SeatType[]>(`/api/rooftops/${rooftopId}/seat-types?include_inactive=true`),
      api.get<InviteOut[]>(`/api/rooftops/${rooftopId}/invites`).catch(() => []),
    ]);
    setCities(cs);
    setAllRooftops(all);
    const r = all.find((x) => x.id === rooftopId) ?? null;
    setRooftop(r);
    if (r) setForm({ name: r.name, address: r.address, description: r.description ?? "", lat: r.lat, lng: r.lng });
    setSeatTypes(st);
    setInvites(iv);
  }
  useEffect(() => { reload(); }, [rooftopId]); // eslint-disable-line

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null);
    try {
      await api.patch(`/api/rooftops/${rooftopId}`, form);
      setInfo("Сохранено");
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function addSt(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post(`/api/rooftops/${rooftopId}/seat-types`, newSt);
      setNewSt({ name: "", default_price: 0, default_count: 0, capacity: 1 });
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function updateSt(st: SeatType, patch: Partial<SeatType>) {
    setErr(null);
    try {
      await api.patch(`/api/rooftops/${rooftopId}/seat-types/${st.id}`, patch);
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function deleteSt(st: SeatType) {
    const confirmMsg = `Если он уже используется в показах — будет деактивирован, исторические показы сохранят его. Иначе удалится полностью.`;
    if (!await confirm({ title: `Удалить тип «${st.name}»?`, message: confirmMsg, confirmText: "Удалить", danger: true })) return;
    try {
      const res = await api.del<{ deleted: boolean; deactivated: boolean; in_use_count: number }>(
        `/api/rooftops/${rooftopId}/seat-types/${st.id}`
      );
      setInfo(res.deactivated ? `Тип «${st.name}» деактивирован (используется в ${res.in_use_count} показах)` : `Тип «${st.name}» удалён`);
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function createInvite() {
    try {
      // Текущая крыша всегда идёт первой (становится primary_rooftop_id)
      const rooftop_ids = [rooftopId, ...inviteExtraRooftopIds.filter((id) => id !== rooftopId)];
      await api.post(`/api/admin/invites`, { permissions: invitePerms, rooftop_ids });
      setShowInviteForm(false);
      setInvitePerms(null);
      setInviteExtraRooftopIds([]);
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  function toggleInviteExtraRooftop(id: number) {
    setInviteExtraRooftopIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleInvitePerm(perm: string) {
    if (invitePerms === null) {
      // Was "all rights" → switch to specific list with this perm only
      setInvitePerms([perm]);
    } else if (invitePerms.includes(perm)) {
      setInvitePerms(invitePerms.filter((p) => p !== perm));
    } else {
      setInvitePerms([...invitePerms, perm]);
    }
  }
  async function revokeInvite(iv: InviteOut) {
    try {
      await api.post(`/api/rooftops/${rooftopId}/invites/${iv.id}/revoke`);
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  if (!rooftop) return <div className="empty">Загрузка...</div>;
  const city = cities.find((c) => c.id === rooftop.city_id);

  return (
    <div>
      <button className="ghost" onClick={() => nav("/admin/rooftops")} style={{ marginTop: 12 }}>← К списку</button>
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      {info && <div className="hint-box" style={{ marginTop: 12 }}>{info}</div>}

      <h2 style={{ marginTop: 16 }}>{rooftop.name} <span className="muted" style={{ fontSize: 14 }}>· {city?.name}</span></h2>

      <form onSubmit={save} className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Основное</h3>
        <div className="row gap" style={{ flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Название</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 260 }}>
            <label>
              Адрес
              {form.lat != null && <span className="badge accent" style={{ marginLeft: 8 }}>координаты есть</span>}
            </label>
            <Autocomplete<AddressSuggestion>
              value={form.address}
              onChange={(v) => setForm({ ...form, address: v, lat: null, lng: null })}
              fetcher={async (q) => city ? await api.get<AddressSuggestion[]>(
                `/api/geocode/addresses?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city.name)}`) : []}
              onPick={(o) => setForm({ ...form, address: o.address, lat: o.lat, lng: o.lng })}
            />
          </div>
        </div>
        <div className="field">
          <label>Описание</label>
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <button className="primary" type="submit">Сохранить</button>
      </form>

      <h3>Типы мест на этой крыше</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Эти типы предлагаются при создании показа. Цена и количество — значения по умолчанию,
        для каждого показа можно поменять. Удаление используемого типа делает его «скрытым», но не ломает прошлые показы.
      </p>

      <form onSubmit={addSt} className="card" style={{ marginBottom: 12 }}>
        <div className="row gap" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label>Название</label>
            <input required placeholder="Кресло-мешок" value={newSt.name} onChange={(e) => setNewSt({ ...newSt, name: e.target.value })} />
          </div>
          <div className="field" style={{ width: 140, marginBottom: 0 }}>
            <label>Цена ₽</label>
            <input type="number" min={0} value={newSt.default_price} onChange={(e) => setNewSt({ ...newSt, default_price: Number(e.target.value) })} />
          </div>
          <div className="field" style={{ width: 110, marginBottom: 0 }}>
            <label>Количество</label>
            <input type="number" min={0} value={newSt.default_count} onChange={(e) => setNewSt({ ...newSt, default_count: Number(e.target.value) })} />
          </div>
          <div className="field" style={{ width: 130, marginBottom: 0 }}>
            <label title="Сколько гостей помещается на одно такое место (скамейка=2)">Гостей/место</label>
            <input
              type="number"
              min={1}
              max={20}
              value={newSt.capacity}
              onChange={(e) => setNewSt({ ...newSt, capacity: Math.max(1, Number(e.target.value)) })}
            />
          </div>
          <button className="primary" type="submit">Добавить</button>
        </div>
      </form>

      <div className="cards-grid">
        {seatTypes.map((st) => (
          <div key={st.id} className={"card" + (st.is_active ? "" : " card-inactive")}>
            <div className="row between">
              <input style={{ flex: 1, marginRight: 8 }} value={st.name} onChange={(e) => updateSt(st, { name: e.target.value })} />
              <button className="ghost danger-on-hover" onClick={() => deleteSt(st)} title="Удалить">✕</button>
            </div>
            <div className="row gap" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <div className="field" style={{ width: 110, marginBottom: 0 }}>
                <label>Цена ₽</label>
                <input type="number" min={0} value={st.default_price}
                       onChange={(e) => updateSt(st, { default_price: Number(e.target.value) })} />
              </div>
              <div className="field" style={{ width: 110, marginBottom: 0 }}>
                <label>Количество</label>
                <input type="number" min={0} value={st.default_count}
                       onChange={(e) => updateSt(st, { default_count: Number(e.target.value) })} />
              </div>
              <div className="field" style={{ width: 130, marginBottom: 0 }}>
                <label title="Сколько гостей помещается на одно такое место">Гостей/место</label>
                <input type="number" min={1} max={20} value={st.capacity ?? 1}
                       onChange={(e) => updateSt(st, { capacity: Math.max(1, Number(e.target.value)) })} />
              </div>
            </div>
            {!st.is_active && <span className="badge" style={{ marginTop: 8 }}>скрыт (есть в прошлых показах)</span>}
          </div>
        ))}
        {seatTypes.length === 0 && <div className="empty">Типов мест ещё нет. Добавьте первый.</div>}
      </div>

      <h3 style={{ marginTop: 32 }}>Администраторы крыши</h3>
      <div className="row gap" style={{ marginBottom: 12 }}>
        <button
          className="primary"
          onClick={() => {
            if (showInviteForm) {
              setShowInviteForm(false);
              setInvitePerms(null);
              setInviteExtraRooftopIds([]);
            } else {
              setShowInviteForm(true);
            }
          }}
        >
          {showInviteForm ? "Отмена" : "+ Новая ссылка-приглашение"}
        </button>
      </div>

      {showInviteForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h4 style={{ marginTop: 0, marginBottom: 8 }}>Крыши для этого приглашения</h4>
          {/* Текущая крыша — всегда включена */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 6, opacity: 0.7 }}>
            <input type="checkbox" checked disabled />
            <span>{rooftop.name} <span className="muted">(текущая, обязательно)</span></span>
          </label>
          {/* Остальные крыши, сгруппированные по городам */}
          {cities
            .filter((c) => allRooftops.some((r) => r.city_id === c.id && r.id !== rooftopId))
            .map((c) => (
              <div key={c.id} style={{ marginBottom: 6 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>{c.name}</div>
                {allRooftops
                  .filter((r) => r.city_id === c.id && r.id !== rooftopId)
                  .map((r) => (
                    <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 3, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={inviteExtraRooftopIds.includes(r.id)}
                        onChange={() => toggleInviteExtraRooftop(r.id)}
                      />
                      {r.name}
                    </label>
                  ))}
              </div>
            ))}
          <h4 style={{ marginBottom: 8 }}>Права нового администратора</h4>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={invitePerms === null}
                onChange={() => setInvitePerms(invitePerms === null ? [] : null)}
              />
              Все права (без ограничений)
            </label>
          </div>
          {invitePerms !== null && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", marginBottom: 12 }}>
              {PERM_OPTIONS.map((p) => (
                <label key={p.value} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={invitePerms.includes(p.value)}
                    onChange={() => toggleInvitePerm(p.value)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          )}
          {invitePerms !== null && invitePerms.length === 0 && (
            <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              ⚠️ Без прав администратор не увидит ни одного раздела.
            </div>
          )}
          <button className="primary" onClick={createInvite}>Создать приглашение</button>
        </div>
      )}

      <div className="cards-grid">
        {invites.map((iv) => {
          const url = `${window.location.origin}/invite/${iv.token}`;
          const status = iv.revoked_at ? "отозвано"
            : iv.accepted_at ? "принято"
            : new Date(iv.expires_at) < new Date() ? "истекло"
            : "ожидает";
          const permLabel = iv.permissions === null
            ? "Все права"
            : iv.permissions.length === 0
              ? "Без прав"
              : iv.permissions
                  .map((p) => PERM_OPTIONS.find((o) => o.value === p)?.label ?? p)
                  .join(", ");
          return (
            <div key={iv.id} className="card">
              <div className="row between">
                <span className="badge">{status}</span>
                {!iv.accepted_at && !iv.revoked_at && (
                  <button className="ghost" onClick={() => revokeInvite(iv)}>Отозвать</button>
                )}
              </div>
              {!iv.accepted_at && !iv.revoked_at && (
                <input readOnly value={url} style={{ marginTop: 8, fontSize: 11 }} onFocus={(e) => e.currentTarget.select()} />
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                действует до {new Date(iv.expires_at).toLocaleDateString("ru-RU")}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Права: {permLabel}
              </div>
              {iv.target_rooftop_ids && iv.target_rooftop_ids.length > 1 && (
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  Крыши: {iv.target_rooftop_ids
                    .map((rid) => allRooftops.find((r) => r.id === rid)?.name ?? `#${rid}`)
                    .join(", ")}
                </div>
              )}
            </div>
          );
        })}
        {invites.length === 0 && <div className="empty">Приглашений пока нет.</div>}
      </div>
    </div>
  );
}
