import { useEffect, useState } from "react";
import { api, type City } from "../../api";
import Autocomplete from "../../components/Autocomplete";

type CitySuggestion = { name: string; region: string; display: string };
type Timezone = { value: string; label: string };

export default function CitiesAdmin() {
  const [cities, setCities] = useState<City[]>([]);
  const [timezones, setTimezones] = useState<Timezone[]>([]);
  const [newCity, setNewCity] = useState({ name: "", timezone: "Europe/Moscow" });
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try { setCities(await api.get<City[]>("/api/cities?active_only=false")); } catch {}
    try { setTimezones(await api.get<Timezone[]>("/api/cities/timezones")); } catch {}
  }
  useEffect(() => { reload(); }, []);

  async function createCity(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/api/cities", newCity);
      setNewCity({ name: "", timezone: "Europe/Moscow" });
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function deleteCity(c: City) {
    setErr(null);
    let info: { rooftops: number; screenings: number };
    try {
      info = await api.get(`/api/cities/${c.id}/dependents`);
    } catch (e: any) { setErr(e.message); return; }
    const hasDeps = info.rooftops > 0 || info.screenings > 0;
    const msg = hasDeps
      ? `К городу «${c.name}» привязано ${info.rooftops} крыш(а) и ${info.screenings} показ(ов). Удалить вместе с ними?`
      : `Удалить «${c.name}»?`;
    if (!window.confirm(msg)) return;
    try {
      await api.del(`/api/cities/${c.id}${hasDeps ? "?force=true" : ""}`);
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div>
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      <h2 style={{ marginTop: 16 }}>Города</h2>
      <form onSubmit={createCity} className="card" style={{ marginBottom: 16 }}>
        <div className="row gap" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
            <label>Название города</label>
            <Autocomplete<CitySuggestion>
              value={newCity.name}
              onChange={(v) => setNewCity({ ...newCity, name: v })}
              placeholder="например: Москва"
              required
              fetcher={async (q) => await api.get<CitySuggestion[]>(`/api/geocode/cities?q=${encodeURIComponent(q)}`)}
              onPick={(o) => setNewCity({ ...newCity, name: o.name })}
            />
          </div>
          <div className="field" style={{ width: 260, marginBottom: 0 }}>
            <label>Часовой пояс</label>
            <select value={newCity.timezone} onChange={(e) => setNewCity({ ...newCity, timezone: e.target.value })}>
              {timezones.length === 0 && <option value="Europe/Moscow">Москва (UTC+3)</option>}
              {timezones.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </div>
          <button className="primary" type="submit">Добавить</button>
        </div>
      </form>

      <div className="cards-grid">
        {cities.map((c) => {
          const tzLabel = timezones.find((t) => t.value === c.timezone)?.label ?? c.timezone;
          return (
            <div key={c.id} className="card">
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ margin: 0 }}>{c.name}</h3>
                  <div className="meta">{tzLabel}</div>
                </div>
                <button className="ghost danger-on-hover" onClick={() => deleteCity(c)} title="Удалить город">✕</button>
              </div>
              {!c.is_active && <span className="badge" style={{ marginTop: 8 }}>скрыт</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
