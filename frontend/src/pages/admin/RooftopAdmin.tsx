import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type City, type Rooftop, type SeatType } from "../../api";
import Autocomplete from "../../components/Autocomplete";

type AddressSuggestion = { address: string; lat: number; lng: number; display: string; full_display: string };
type InviteOut = {
  id: number; rooftop_id: number; token: string;
  expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string;
};

export default function RooftopAdmin() {
  const { id } = useParams();
  const rooftopId = Number(id);
  const nav = useNavigate();
  const [cities, setCities] = useState<City[]>([]);
  const [rooftop, setRooftop] = useState<Rooftop | null>(null);
  const [form, setForm] = useState({ name: "", address: "", description: "", lat: null as number | null, lng: null as number | null });
  const [seatTypes, setSeatTypes] = useState<SeatType[]>([]);
  const [newSt, setNewSt] = useState({ name: "", default_price: 0, default_count: 0 });
  const [invites, setInvites] = useState<InviteOut[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function reload() {
    const [cs, all, st, iv] = await Promise.all([
      api.get<City[]>("/api/cities?active_only=false"),
      api.get<Rooftop[]>("/api/rooftops?active_only=false"),
      api.get<SeatType[]>(`/api/rooftops/${rooftopId}/seat-types?include_inactive=true`),
      api.get<InviteOut[]>(`/api/rooftops/${rooftopId}/invites`).catch(() => []),
    ]);
    setCities(cs);
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
      setNewSt({ name: "", default_price: 0, default_count: 0 });
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
    const confirmMsg = `Удалить тип «${st.name}»? Если он уже используется в показах — будет деактивирован, исторические показы сохранят его.`;
    if (!window.confirm(confirmMsg)) return;
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
      await api.post(`/api/rooftops/${rooftopId}/invites`);
      await reload();
    } catch (e: any) { setErr(e.message); }
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
            <div className="row gap" style={{ marginTop: 10 }}>
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
            </div>
            {!st.is_active && <span className="badge" style={{ marginTop: 8 }}>скрыт (есть в прошлых показах)</span>}
          </div>
        ))}
        {seatTypes.length === 0 && <div className="empty">Типов мест ещё нет. Добавьте первый.</div>}
      </div>

      <h3 style={{ marginTop: 32 }}>Администраторы крыши</h3>
      <div className="row gap" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={createInvite}>+ Новая ссылка-приглашение</button>
      </div>
      <div className="cards-grid">
        {invites.map((iv) => {
          const url = `${window.location.origin}/invite/${iv.token}`;
          const status = iv.revoked_at ? "отозвано"
            : iv.accepted_at ? "принято"
            : new Date(iv.expires_at) < new Date() ? "истекло"
            : "ожидает";
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
            </div>
          );
        })}
        {invites.length === 0 && <div className="empty">Приглашений пока нет.</div>}
      </div>
    </div>
  );
}
