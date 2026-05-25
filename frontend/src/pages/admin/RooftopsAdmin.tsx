import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type City, type Rooftop } from "../../api";
import Autocomplete from "../../components/Autocomplete";

type AddressSuggestion = { address: string; lat: number; lng: number; display: string; full_display: string };

export default function RooftopsAdmin() {
  const [cities, setCities] = useState<City[]>([]);
  const [rooftops, setRooftops] = useState<Rooftop[]>([]);
  const [newRoof, setNewRoof] = useState({
    city_id: 0, name: "", address: "", description: "",
    lat: null as number | null, lng: null as number | null,
  });
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    const [cs, rs] = await Promise.all([
      api.get<City[]>("/api/cities?active_only=false"),
      api.get<Rooftop[]>("/api/rooftops?active_only=false"),
    ]);
    setCities(cs);
    setRooftops(rs);
  }
  useEffect(() => { reload(); }, []);

  async function createRoof(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/api/rooftops", {
        city_id: Number(newRoof.city_id), name: newRoof.name, address: newRoof.address,
        description: newRoof.description, lat: newRoof.lat, lng: newRoof.lng,
      });
      setNewRoof({ city_id: 0, name: "", address: "", description: "", lat: null, lng: null });
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function deleteRoof(r: Rooftop) {
    if (!window.confirm(`Удалить крышу «${r.name}»? Это удалит все её показы и связи.`)) return;
    try {
      await api.del(`/api/rooftops/${r.id}`);
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div>
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      <h2 style={{ marginTop: 16 }}>Крыши</h2>
      <form onSubmit={createRoof} className="card" style={{ marginBottom: 16 }}>
        <div className="row gap" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ width: 220, marginBottom: 0 }}>
            <label>Город</label>
            <select required value={newRoof.city_id || ""} onChange={(e) =>
              setNewRoof({ ...newRoof, city_id: Number(e.target.value), address: "", lat: null, lng: null })}>
              <option value="">—</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label>Название крыши</label>
            <input required value={newRoof.name} onChange={(e) => setNewRoof({ ...newRoof, name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 260, marginBottom: 0 }}>
            <label>
              Адрес
              {!newRoof.city_id && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>(сначала выберите город)</span>}
              {newRoof.lat != null && <span className="badge accent" style={{ marginLeft: 8 }}>координаты определены</span>}
            </label>
            <Autocomplete<AddressSuggestion>
              value={newRoof.address}
              onChange={(v) => setNewRoof({ ...newRoof, address: v, lat: null, lng: null })}
              placeholder={newRoof.city_id ? "ул. Тверская, 1" : "Сначала выберите город"}
              disabled={!newRoof.city_id}
              fetcher={async (q) => {
                const city = cities.find((c) => c.id === newRoof.city_id);
                if (!city) return [];
                return await api.get<AddressSuggestion[]>(
                  `/api/geocode/addresses?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city.name)}`
                );
              }}
              onPick={(o) => setNewRoof({ ...newRoof, address: o.address, lat: o.lat, lng: o.lng })}
            />
          </div>
          <button className="primary" type="submit" disabled={!newRoof.city_id}>Добавить</button>
        </div>
        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
          <label>Описание</label>
          <textarea rows={2} value={newRoof.description}
            onChange={(e) => setNewRoof({ ...newRoof, description: e.target.value })} />
        </div>
      </form>

      <div className="cards-grid">
        {rooftops.map((r) => {
          const city = cities.find((c) => c.id === r.city_id);
          return (
            <div key={r.id} className="card">
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>{r.name}</h3>
                  <div className="meta">{city?.name}</div>
                </div>
                <button className="ghost danger-on-hover" onClick={() => deleteRoof(r)} title="Удалить">✕</button>
              </div>
              {r.description && <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{r.description}</p>}
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Link to={`/admin/rooftops/${r.id}`} className="btn-as-link">Редактировать</Link>
                <Link to={`/rooftops/${r.id}`} className="btn-as-link ghost">Открыть</Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
