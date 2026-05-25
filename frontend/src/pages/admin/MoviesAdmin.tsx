import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Movie } from "../../api";
import { useDebouncedValue } from "../../lib/hooks";

export default function MoviesAdmin() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [q, setQ] = useState("");
  const debQ = useDebouncedValue(q, 300);

  async function reload() {
    const url = debQ.trim() ? `/api/movies?q=${encodeURIComponent(debQ.trim())}` : "/api/movies";
    try { setMovies(await api.get<Movie[]>(url)); } catch {}
  }
  useEffect(() => { reload(); }, [debQ]); // eslint-disable-line

  return (
    <div>
      <div className="row between" style={{ marginTop: 16, gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Фильмы</h2>
        <div className="row gap" style={{ flex: 1, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <input
            placeholder="Поиск по названию..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <Link to="/admin/movies/new" className="btn-as-link primary">+ Добавить фильм</Link>
        </div>
      </div>

      {movies.length === 0 ? (
        <div className="empty" style={{ marginTop: 16 }}>
          {debQ.trim() ? "Ничего не нашлось. Можно добавить вручную." : "Пока нет фильмов."}
        </div>
      ) : (
        <div className="movies-grid">
          {movies.map((m) => (
            <Link key={m.id} to={`/admin/movies/${m.id}`} className="movie-card">
              <div className="poster">
                {m.poster_url ? <img src={m.poster_url} alt="" loading="lazy" /> :
                  <div className="poster-placeholder">{m.title[0]}</div>}
                {(m.imdb_rating != null || m.kinopoisk_rating != null) && (
                  <div className="poster-ratings">
                    {m.imdb_rating != null && (
                      <span className="rating-badge"><b>{m.imdb_rating.toFixed(1)}</b><span className="rb-label">IMDb</span></span>
                    )}
                    {m.kinopoisk_rating != null && (
                      <span className="rating-badge"><b>{m.kinopoisk_rating.toFixed(1)}</b><span className="rb-label">Кп</span></span>
                    )}
                  </div>
                )}
                {m.age_rating && <span className="age-badge">{m.age_rating}</span>}
              </div>
              <div className="movie-meta">
                <h3>{m.title}</h3>
                <div className="muted" style={{ fontSize: 12 }}>
                  {[m.year, m.duration_min ? `${m.duration_min} мин` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
