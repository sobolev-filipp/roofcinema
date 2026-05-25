import { useEffect, useState } from "react";
import { api, type Movie, type PayoutTemplate, type Rooftop, type Screening, type SeatType } from "../../api";

type Alloc = { seat_type_id: number; price: number; count: number; capacity: number };

export default function ScreeningsAdmin() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [rooftops, setRooftops] = useState<Rooftop[]>([]);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [templates, setTemplates] = useState<PayoutTemplate[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    movie_id: 0, rooftop_id: 0, starts_at: "",
    booking_window_minutes: 120, base_price: 0,
    booking_opens_at: "",
    booking_closes_at: "",
    payout_template_id: null as number | null,
  });
  const [seatTypes, setSeatTypes] = useState<SeatType[]>([]);
  const [allocs, setAllocs] = useState<Alloc[]>([]);

  async function reload() {
    const [ms, rs, sc, tpls] = await Promise.all([
      api.get<Movie[]>("/api/movies"),
      api.get<Rooftop[]>("/api/rooftops?active_only=false"),
      api.get<Screening[]>("/api/screenings?include_inactive=true"),
      api.get<PayoutTemplate[]>("/api/payout-templates").catch(() => [] as PayoutTemplate[]),
    ]);
    setMovies(ms); setRooftops(rs); setScreenings(sc); setTemplates(tpls);
    // подставим шаблон по умолчанию для новой формы
    const def = tpls.find((t) => t.is_default);
    if (def) setForm((f) => f.payout_template_id == null ? { ...f, payout_template_id: def.id } : f);
  }
  useEffect(() => { reload(); }, []);

  // при смене крыши подгружаем её типы мест и предзаполняем аллокации
  useEffect(() => {
    if (!form.rooftop_id) { setSeatTypes([]); setAllocs([]); return; }
    api.get<SeatType[]>(`/api/rooftops/${form.rooftop_id}/seat-types`)
      .then((sts) => {
        setSeatTypes(sts);
        setAllocs(sts.map((st) => ({
          seat_type_id: st.id,
          price: st.default_price,
          count: st.default_count,
          capacity: st.capacity ?? 1,
        })));
      })
      .catch(() => { setSeatTypes([]); setAllocs([]); });
  }, [form.rooftop_id]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/api/screenings", {
        ...form,
        movie_id: Number(form.movie_id),
        rooftop_id: Number(form.rooftop_id),
        booking_opens_at: form.booking_opens_at || null,
        booking_closes_at: form.booking_closes_at || null,
        payout_template_id: form.payout_template_id || null,
        seat_allocations: allocs.filter((a) => a.count > 0),
      });
      const def = templates.find((t) => t.is_default);
      setForm({
        movie_id: 0, rooftop_id: 0, starts_at: "",
        booking_window_minutes: 120, base_price: 0,
        booking_opens_at: "", booking_closes_at: "",
        payout_template_id: def?.id ?? null,
      });
      setSeatTypes([]); setAllocs([]);
      await reload();
    } catch (e: any) { setErr(e.message); }
  }

  async function remove(s: Screening) {
    if (!window.confirm("Удалить показ?")) return;
    try { await api.del(`/api/screenings/${s.id}`); await reload(); }
    catch (e: any) { setErr(e.message); }
  }

  function updateAlloc(seatTypeId: number, patch: Partial<Alloc>) {
    setAllocs((cur) => cur.map((a) => a.seat_type_id === seatTypeId ? { ...a, ...patch } : a));
  }

  return (
    <div>
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      <h2 style={{ marginTop: 16 }}>Показы</h2>
      <form onSubmit={create} className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Новый показ</h3>
        <div className="row gap" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
            <label>Фильм</label>
            <select required value={form.movie_id || ""} onChange={(e) => setForm({ ...form, movie_id: Number(e.target.value) })}>
              <option value="">—</option>
              {movies.map((m) => <option key={m.id} value={m.id}>{m.title}{m.year ? ` (${m.year})` : ""}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
            <label>Крыша</label>
            <select required value={form.rooftop_id || ""} onChange={(e) => setForm({ ...form, rooftop_id: Number(e.target.value) })}>
              <option value="">—</option>
              {rooftops.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ width: 220, marginBottom: 0 }}>
            <label>Дата и время</label>
            <input type="datetime-local" required value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
          </div>
          <div className="field" style={{ width: 140, marginBottom: 0 }}>
            <label title="Сколько минут даётся на оплату одной брони">Таймер брони, мин</label>
            <input type="number" min={10} max={1440} value={form.booking_window_minutes}
                   onChange={(e) => setForm({ ...form, booking_window_minutes: Number(e.target.value) })} />
          </div>
        </div>

        <div className="row gap" style={{ flexWrap: "wrap", marginTop: 10 }}>
          <div className="field" style={{ width: 240, marginBottom: 0 }}>
            <label title="С какого момента можно бронировать. Пусто — сразу открыто.">Открыть бронирование</label>
            <input
              type="datetime-local"
              value={form.booking_opens_at}
              onChange={(e) => setForm({ ...form, booking_opens_at: e.target.value })}
            />
          </div>
          <div className="field" style={{ width: 240, marginBottom: 0 }}>
            <label title="После этого момента нельзя забронировать. Пусто — до начала показа.">Закрыть бронирование</label>
            <input
              type="datetime-local"
              value={form.booking_closes_at}
              onChange={(e) => setForm({ ...form, booking_closes_at: e.target.value })}
            />
          </div>
        </div>

        <div className="row gap" style={{ flexWrap: "wrap", marginTop: 10 }}>
          <div className="field" style={{ flex: 1, minWidth: 280, marginBottom: 0 }}>
            <label>Реквизиты для оплаты переводом</label>
            <select
              value={form.payout_template_id ?? ""}
              onChange={(e) => setForm({ ...form, payout_template_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— не указаны —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.recipient_name}){t.is_default ? " ★" : ""}
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Создайте шаблон во вкладке «Реквизиты», чтобы привязать его к показу.
              </div>
            )}
          </div>
        </div>

        {form.rooftop_id ? (
          seatTypes.length === 0 ? (
            <div className="hint-box" style={{ marginTop: 16 }}>
              На этой крыше нет активных типов мест. Сначала добавьте их в «Крышах».
            </div>
          ) : (
            <>
              <h4 style={{ marginTop: 20 }}>Типы мест для этого показа</h4>
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                Цена и количество подставлены из крыши, можно изменить только для этого показа.
              </p>
              <div className="alloc-grid">
                {seatTypes.map((st) => {
                  const a = allocs.find((x) => x.seat_type_id === st.id);
                  if (!a) return null;
                  return (
                    <div key={st.id} className="alloc-row">
                      <div className="alloc-name">{st.name}</div>
                      <div className="row gap" style={{ flexWrap: "wrap" }}>
                        <div className="field" style={{ width: 110, marginBottom: 0 }}>
                          <label>Цена ₽</label>
                          <input type="number" min={0} value={a.price}
                                 onChange={(e) => updateAlloc(st.id, { price: Number(e.target.value) })} />
                        </div>
                        <div className="field" style={{ width: 110, marginBottom: 0 }}>
                          <label>Количество</label>
                          <input type="number" min={0} value={a.count}
                                 onChange={(e) => updateAlloc(st.id, { count: Number(e.target.value) })} />
                        </div>
                        <div className="field" style={{ width: 120, marginBottom: 0 }}>
                          <label title="Сколько гостей на одно место">Гостей/место</label>
                          <input type="number" min={1} max={20} value={a.capacity}
                                 onChange={(e) => updateAlloc(st.id, { capacity: Math.max(1, Number(e.target.value)) })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )
        ) : (
          <div className="muted" style={{ marginTop: 16, fontSize: 13 }}>Выберите крышу, чтобы указать типы мест.</div>
        )}

        <button className="primary" type="submit" style={{ marginTop: 16 }}
                disabled={!form.movie_id || !form.rooftop_id || !form.starts_at}>
          Создать показ
        </button>
      </form>

      <div className="cards-grid">
        {screenings.map((s) => (
          <div key={s.id} className="card">
            <div className="row between">
              <h3 style={{ margin: 0, fontSize: 15 }}>{s.movie.title}</h3>
              <button className="ghost danger-on-hover" onClick={() => remove(s)} title="Удалить">✕</button>
            </div>
            <div className="meta">{new Date(s.starts_at).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{s.rooftop.name}</div>
            {s.seats.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12 }}>
                {s.seats.map((sa) => (
                  <div key={sa.id} className="row between" style={{ borderTop: "1px solid var(--border)", padding: "4px 0" }}>
                    <span>{sa.name}{sa.capacity > 1 ? ` (×${sa.capacity} гостя)` : ""}</span>
                    <span className="muted">
                      {Number(sa.price).toFixed(0)} ₽ · осталось {sa.seats_available}/{sa.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!s.is_active && <span className="badge" style={{ marginTop: 8 }}>скрыт</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
