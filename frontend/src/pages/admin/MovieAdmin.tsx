import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getToken, type Movie, type MovieStill } from "../../api";
import ImageUpload from "../../components/ImageUpload";
import { ProjectorLoader, Spinner } from "../../components/Loaders";
import { useUI } from "../../ui";

type ExternalHit = {
  source: "kinopoisk" | "omdb";
  external_id: string | number;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_url: string | null;
  description: string | null;
  director: string | null;
  genres: string | null;
  age_rating: string | null;
  duration_min: number | null;
  imdb_id: string | null;
  imdb_rating: number | null;
  kinopoisk_rating: number | null;
};
type SearchResp = {
  configured: boolean;
  sources: string[];
  local: { movie_id: number; title: string; year: number | null; poster_url: string | null }[];
  external: ExternalHit[];
};

type FormState = {
  title: string;
  original_title: string;
  description: string;
  poster_url: string;
  trailer_url: string;
  duration_min: string;
  year: string;
  age_rating: string;
  genres: string;
  director: string;
  imdb_id: string;
  imdb_rating: string;
  kinopoisk_rating: string;
};

const emptyForm: FormState = {
  title: "", original_title: "", description: "", poster_url: "", trailer_url: "",
  duration_min: "", year: "", age_rating: "", genres: "", director: "",
  imdb_id: "", imdb_rating: "", kinopoisk_rating: "",
};

function movieToForm(m: Movie): FormState {
  return {
    title: m.title, original_title: m.original_title ?? "",
    description: m.description ?? "", poster_url: m.poster_url ?? "", trailer_url: m.trailer_url ?? "",
    duration_min: m.duration_min?.toString() ?? "", year: m.year?.toString() ?? "",
    age_rating: m.age_rating ?? "", genres: m.genres ?? "", director: m.director ?? "",
    imdb_id: m.imdb_id ?? "", imdb_rating: m.imdb_rating?.toString() ?? "",
    kinopoisk_rating: m.kinopoisk_rating?.toString() ?? "",
  };
}

function hitToForm(h: ExternalHit): FormState {
  return {
    title: h.title ?? "", original_title: h.original_title ?? "",
    description: h.description ?? "", poster_url: h.poster_url ?? "", trailer_url: "",
    duration_min: h.duration_min?.toString() ?? "", year: h.year?.toString() ?? "",
    age_rating: h.age_rating ?? "", genres: h.genres ?? "", director: h.director ?? "",
    imdb_id: h.imdb_id ?? "", imdb_rating: h.imdb_rating?.toString() ?? "",
    kinopoisk_rating: h.kinopoisk_rating?.toString() ?? "",
  };
}

function formToPayload(f: FormState) {
  const num = (s: string) => (s.trim() ? Number(s) : null);
  return {
    title: f.title,
    original_title: f.original_title || null,
    description: f.description || null,
    poster_url: f.poster_url || null,
    trailer_url: f.trailer_url || null,
    duration_min: num(f.duration_min),
    year: num(f.year),
    age_rating: f.age_rating || null,
    genres: f.genres || null,
    director: f.director || null,
    imdb_id: f.imdb_id || null,
    imdb_rating: num(f.imdb_rating),
    kinopoisk_rating: num(f.kinopoisk_rating),
  };
}

export default function MovieAdmin() {
  const { confirm, notify } = useUI();
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = !id;

  const [stage, setStage] = useState<"search" | "form">(isNew ? "search" : "form");
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResp | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [stills, setStills] = useState<MovieStill[]>([]);
  const [newStillUrl, setNewStillUrl] = useState("");
  const [stillBusy, setStillBusy] = useState(false);
  const stillFileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    api.get<Movie>(`/api/movies/${id}`)
      .then((m) => { setForm(movieToForm(m)); setStills(m.stills ?? []); })
      .catch((e) => setErr(e.message));
  }, [id, isNew]);

  async function addStillByUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !newStillUrl.trim()) return;
    setStillBusy(true); setErr(null);
    try {
      const s = await api.post<MovieStill>(`/api/movies/${id}/stills`, {
        image_url: newStillUrl.trim(),
        position: (stills.at(-1)?.position ?? 0) + 1,
      });
      setStills([...stills, s]);
      setNewStillUrl("");
    } catch (e: any) { setErr(e.message); }
    finally { setStillBusy(false); }
  }

  async function uploadStill(file: File) {
    if (!id) return;
    setStillBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Ошибка ${res.status}`);
      const s = await api.post<MovieStill>(`/api/movies/${id}/stills`, {
        image_url: data.url,
        position: (stills.at(-1)?.position ?? 0) + 1,
      });
      setStills([...stills, s]);
    } catch (e: any) { setErr(e.message); }
    finally { setStillBusy(false); if (stillFileRef.current) stillFileRef.current.value = ""; }
  }

  async function removeStill(s: MovieStill) {
    if (!id) return;
    if (!await confirm({ title: "Удалить кадр?", message: "Этот кадр удалится из карточки фильма.", confirmText: "Удалить", danger: true })) return;
    try {
      await api.del(`/api/movies/${id}/stills/${s.id}`);
      setStills(stills.filter((x) => x.id !== s.id));
    } catch (e: any) { setErr(e.message); }
  }

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQ.trim()) return;
    setSearching(true); setErr(null);
    try {
      const res = await api.get<SearchResp>(`/api/movies/external-search?q=${encodeURIComponent(searchQ)}`);
      setSearchResult(res);
    } catch (e: any) { setErr(e.message); }
    finally { setSearching(false); }
  }

  function fillFromHit(h: ExternalHit) {
    setForm(hitToForm(h));
    setStage("form");
  }

  function fillManually() {
    setForm({ ...emptyForm, title: searchQ });
    setStage("form");
  }

  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setErr(null); setInfo(null);
    setSaving(true);
    try {
      if (isNew) {
        await api.post<Movie>("/api/movies", formToPayload(form));
      } else {
        await api.patch(`/api/movies/${id}`, formToPayload(form));
      }
      // Закрываем редактор и возвращаемся в список — пользователь увидит,
      // что действие завершилось.
      notify({
        title: isNew ? "Фильм создан" : "Сохранено",
        message: isNew ? "Можно добавить кадры и постер." : "Изменения применены.",
        kind: "success",
      });
      nav("/admin/movies");
    } catch (e: any) {
      setErr(e.message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!id) return;
    if (!await confirm({ title: "Удалить фильм?", message: "Все его показы тоже будут удалены. Действие необратимо.", confirmText: "Удалить фильм", danger: true })) return;
    try {
      await api.del(`/api/movies/${id}`);
      nav("/admin/movies");
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div>
      {saving && <ProjectorLoader text={isNew ? "Создаём фильм" : "Сохраняем"} />}
      <button className="ghost" onClick={() => nav("/admin/movies")} style={{ marginTop: 12 }}>← К списку</button>
      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      {info && <div className="hint-box" style={{ marginTop: 12 }}>{info}</div>}

      {isNew && stage === "search" && (
        <div style={{ marginTop: 16 }}>
          <h2>Новый фильм</h2>
          <form onSubmit={doSearch} className="card">
            <label>Название</label>
            <div className="row gap" style={{ alignItems: "flex-end" }}>
              <input
                required autoFocus placeholder="например: Inception"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="primary" type="submit" disabled={searching}>
                {searching ? "Ищем..." : "Найти"}
              </button>
              <button type="button" className="ghost" onClick={fillManually}>
                Заполнить вручную
              </button>
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Сначала ищем в локальной базе и во внешних источниках (IMDB через OMDb, Кинопоиск).
              Если ничего подходящего не найдено — можно заполнить руками.
            </p>
          </form>

          {searchResult && (
            <div style={{ marginTop: 16 }}>
              {!searchResult.configured && (
                <div className="hint-box" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div><b>Внешний поиск не настроен.</b> Чтобы автоматически подтягивать данные о фильмах, нужен бесплатный API-ключ:</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                    <li>
                      <b>OMDb</b> (IMDB-данные, 1000 запросов в день):{" "}
                      <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener">omdbapi.com/apikey.aspx</a>
                      {" "}→ выбрать <i>Free!</i>, ввести email, подтвердить по ссылке.
                    </li>
                    <li>
                      <b>Кинопоиск Unofficial</b> (русские названия и рейтинги):{" "}
                      <a href="https://kinopoiskapiunofficial.tech/" target="_blank" rel="noopener">kinopoiskapiunofficial.tech</a>
                      {" "}→ «Получить API ключ».
                    </li>
                  </ul>
                  <div style={{ fontSize: 13 }}>
                    Полученный ключ положить в <code>backend/.env</code> в строку <code>OMDB_API_KEY=...</code> или
                    {" "}<code>KINOPOISK_API_KEY=...</code> и перезапустить backend.
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Пока этого не сделали — можно <b>заполнить вручную</b>:
                    <button className="primary" style={{ marginLeft: 12 }} onClick={fillManually}>Заполнить вручную</button>
                  </div>
                </div>
              )}

              {searchResult.local.length > 0 && (
                <>
                  <h3 style={{ marginTop: 16 }}>Уже есть в базе</h3>
                  <div className="movies-grid">
                    {searchResult.local.map((m) => (
                      <Link key={m.movie_id} to={`/admin/movies/${m.movie_id}`} className="movie-card">
                        <div className="poster">
                          {m.poster_url ? <img src={m.poster_url} alt="" /> :
                            <div className="poster-placeholder">{m.title[0]}</div>}
                        </div>
                        <div className="movie-meta">
                          <h3>{m.title}</h3>
                          <div className="muted" style={{ fontSize: 12 }}>{m.year}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              )}

              {searchResult.external.length > 0 && (
                <>
                  <h3 style={{ marginTop: 24 }}>Найдено во внешних источниках</h3>
                  <div className="search-hits">
                    {searchResult.external.map((h, i) => (
                      <div key={i} className="card search-hit">
                        {h.poster_url ? (
                          <img src={h.poster_url} alt="" style={{ width: 70, height: 105, objectFit: "cover", borderRadius: 6 }} />
                        ) : (
                          <div style={{ width: 70, height: 105, background: "var(--bg-soft)", borderRadius: 6 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row gap" style={{ alignItems: "baseline" }}>
                            <h3 style={{ margin: 0, fontSize: 16 }}>{h.title}</h3>
                            <span className="badge">{h.source}</span>
                          </div>
                          {h.original_title && h.original_title !== h.title && (
                            <div className="muted" style={{ fontSize: 13 }}>{h.original_title}</div>
                          )}
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {[h.year, h.duration_min ? `${h.duration_min} мин` : null, h.age_rating, h.genres].filter(Boolean).join(" · ")}
                          </div>
                          <div className="row gap" style={{ marginTop: 8 }}>
                            {h.imdb_rating != null && (
                              <span className="rating-badge"><b>{h.imdb_rating.toFixed(1)}</b><span className="rb-label">IMDb</span></span>
                            )}
                            {h.kinopoisk_rating != null && (
                              <span className="rating-badge"><b>{h.kinopoisk_rating.toFixed(1)}</b><span className="rb-label">Кп</span></span>
                            )}
                          </div>
                          {h.description && (
                            <p className="muted" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.4 }}>
                              {h.description.length > 240 ? h.description.slice(0, 240) + "..." : h.description}
                            </p>
                          )}
                          <button className="primary" style={{ marginTop: 8 }} onClick={() => fillFromHit(h)}>
                            Использовать (можно отредактировать)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {searchResult.local.length === 0 && searchResult.external.length === 0 && (
                <div className="empty" style={{ marginTop: 16 }}>
                  Ничего не нашлось. <button className="primary" style={{ marginLeft: 12 }} onClick={fillManually}>
                    Заполнить вручную
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {stage === "form" && (
        <form onSubmit={save} className="card" style={{ marginTop: 16 }}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>{isNew ? "Новый фильм" : "Редактирование фильма"}</h2>
            {!isNew && <button type="button" className="ghost danger-on-hover" onClick={remove}>Удалить</button>}
          </div>
          <div className="row gap movie-form-row" style={{ flexWrap: "wrap", marginTop: 16, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
              <label>Название (на русском)</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
              <label>Оригинальное название</label>
              <input value={form.original_title} onChange={(e) => setForm({ ...form, original_title: e.target.value })} />
            </div>
            <div className="field" style={{ width: 110, marginBottom: 0 }}>
              <label>Год</label>
              <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
            </div>
            <div className="field" style={{ width: 130, marginBottom: 0 }}>
              <label>Длительность, мин *</label>
              <input
                type="number"
                required
                min={1}
                max={600}
                value={form.duration_min}
                onChange={(e) => setForm({ ...form, duration_min: e.target.value })}
                title="Обязательно — используется для авто-расчёта окончания показа"
              />
            </div>
            <div className="field" style={{ width: 90, marginBottom: 0 }}>
              <label>Возраст</label>
              <input placeholder="18+" value={form.age_rating} onChange={(e) => setForm({ ...form, age_rating: e.target.value })} />
            </div>
          </div>
          <div className="row gap movie-form-row" style={{ flexWrap: "wrap", marginTop: 16, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
              <label>Жанры (через запятую)</label>
              <input value={form.genres} onChange={(e) => setForm({ ...form, genres: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
              <label>Режиссёр</label>
              <input value={form.director} onChange={(e) => setForm({ ...form, director: e.target.value })} />
            </div>
          </div>
          <div className="row gap" style={{ flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 280 }}>
              <label>Постер</label>
              <ImageUpload value={form.poster_url} onChange={(url) => setForm({ ...form, poster_url: url })} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label>Трейлер (YouTube / Rutube)</label>
              <input value={form.trailer_url} onChange={(e) => setForm({ ...form, trailer_url: e.target.value })} />
            </div>
          </div>
          <div className="row gap" style={{ flexWrap: "wrap" }}>
            <div className="field" style={{ width: 140 }}>
              <label>IMDb ID</label>
              <input value={form.imdb_id} onChange={(e) => setForm({ ...form, imdb_id: e.target.value })} />
            </div>
            <div className="field" style={{ width: 130 }}>
              <label>Рейтинг IMDb</label>
              <input type="number" step="0.1" value={form.imdb_rating} onChange={(e) => setForm({ ...form, imdb_rating: e.target.value })} />
            </div>
            <div className="field" style={{ width: 130 }}>
              <label>Рейтинг Кинопоиска</label>
              <input type="number" step="0.1" value={form.kinopoisk_rating} onChange={(e) => setForm({ ...form, kinopoisk_rating: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Описание</label>
            <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <button className="primary" type="submit" disabled={saving}>
            {saving && <Spinner />}
            {saving ? (isNew ? "Создаём..." : "Сохраняем...") : (isNew ? "Создать фильм" : "Сохранить")}
          </button>

          {!isNew && (
            <div style={{ marginTop: 32 }}>
              <h3>Кадры из фильма</h3>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Будут показаны на странице фильма в карусели под трейлером.
              </p>

              <div className="stills-admin-grid">
                {stills.map((s) => (
                  <div key={s.id} className="still-admin-item">
                    <img src={s.image_url} alt="" />
                    <button type="button" className="still-remove" onClick={() => removeStill(s)} title="Удалить">✕</button>
                  </div>
                ))}
                {stills.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Пока нет кадров.</div>}
              </div>

              <div className="row gap" style={{ marginTop: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <input
                  ref={stillFileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadStill(f); }}
                />
                <button type="button" onClick={() => stillFileRef.current?.click()} disabled={stillBusy}>
                  {stillBusy && <Spinner />}
                  {stillBusy ? "Загрузка..." : "Загрузить файл"}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>или</span>
                <div className="field" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
                  <input
                    placeholder="вставить URL изображения"
                    value={newStillUrl}
                    onChange={(e) => setNewStillUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addStillByUrl(e as any); } }}
                  />
                </div>
                <button type="button" className="primary" onClick={addStillByUrl} disabled={stillBusy || !newStillUrl.trim()}>
                  Добавить по URL
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
