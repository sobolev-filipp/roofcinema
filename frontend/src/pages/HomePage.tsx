import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type City, type Screening } from "../api";
import { useAuth } from "../auth";
import CitySelector from "../components/CitySelector";
import DateFilter, { defaultRange, rangeBounds, toNaiveIso, type DateRange } from "../components/DateFilter";
import { Skeleton } from "../components/Loaders";

const TIME_RU = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};
const DATE_RU = (iso: string) => {
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const d = new Date(iso);
  return `${d.getDate()} ${months[d.getMonth()]}`;
};

type Group = {
  movie: Screening["movie"];
  screenings: Screening[];
};

export default function HomePage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);
  const [range, setRange] = useState<DateRange>(defaultRange("day"));
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    api.get<City[]>("/api/cities").then(setCities);
  }, []);

  useEffect(() => {
    if (initialized) return;
    if (user) {
      setCityId(user.home_city_id ?? null);
      setInitialized(true);
    } else if (cities.length > 0 || user === null) {
      setInitialized(true);
    }
  }, [user, cities, initialized]);

  useEffect(() => {
    if (!initialized) return;
    setLoading(true);
    const { from, to } = rangeBounds(range);
    const params = new URLSearchParams({
      date_from: toNaiveIso(from),
      date_to: toNaiveIso(to),
    });
    if (cityId !== null) params.set("city_id", String(cityId));
    api.get<Screening[]>(`/api/screenings?${params.toString()}`)
      .then(setScreenings)
      .finally(() => setLoading(false));
  }, [cityId, range, initialized]);

  const grouped: Group[] = useMemo(() => {
    const map = new Map<number, Group>();
    for (const s of screenings) {
      const cur = map.get(s.movie_id) ?? { movie: s.movie, screenings: [] };
      cur.screenings.push(s);
      map.set(s.movie_id, cur);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.screenings[0].starts_at.localeCompare(b.screenings[0].starts_at)
    );
  }, [screenings]);

  const cityById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cities) m.set(c.id, c.name);
    return m;
  }, [cities]);
  const showCity = cityId === null;

  return (
    <div className="container">
      <div className="home-top">
        <CitySelector cities={cities} value={cityId} onChange={setCityId} />
        <DateFilter value={range} onChange={setRange} />
      </div>

      <h1 style={{ marginTop: 24 }}>Афиша</h1>

      {loading ? (
        <div style={{ marginTop: 16 }}>
          <Skeleton variant="card" count={3} />
        </div>
      ) : grouped.length === 0 ? (
        <div className="empty">
          На выбранный период показов нет. Попробуйте другую дату или город.
        </div>
      ) : (
        <div className="movies-grid">
          {grouped.map(({ movie, screenings }) => {
            return (
              <Link to={`/movies/${movie.id}`} key={movie.id} className="movie-card">
                <div className="poster">
                  {movie.poster_url ? (
                    <img src={movie.poster_url} alt="" loading="lazy" />
                  ) : (
                    <div className="poster-placeholder">{movie.title[0]}</div>
                  )}
                  {(movie.imdb_rating != null || movie.kinopoisk_rating != null) && (
                    <div className="poster-ratings">
                      {movie.imdb_rating != null && (
                        <span className="rating-badge">
                          <b>{movie.imdb_rating.toFixed(1)}</b>
                          <span className="rb-label">IMDb</span>
                        </span>
                      )}
                      {movie.kinopoisk_rating != null && (
                        <span className="rating-badge">
                          <b>{movie.kinopoisk_rating.toFixed(1)}</b>
                          <span className="rb-label">Кп</span>
                        </span>
                      )}
                    </div>
                  )}
                  {movie.age_rating && <span className="age-badge">{movie.age_rating}</span>}
                </div>
                <div className="movie-meta">
                  <h3>{movie.title}</h3>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[movie.year, movie.genres, movie.duration_min ? `${movie.duration_min} мин` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="screening-rows">
                    {screenings.slice(0, 4).map((s) => {
                      const cityName = cityById.get(s.rooftop.city_id);
                      const openRooftop = (e: React.MouseEvent) => {
                        // карточка обёрнута в <Link> на фильм — гасим переход
                        e.preventDefault();
                        e.stopPropagation();
                        nav(`/rooftops/${s.rooftop.id}`);
                      };
                      return (
                        <div key={s.id} className="screening-row">
                          <span className="srow-time">
                            {range.mode === "day"
                              ? TIME_RU(s.starts_at)
                              : `${DATE_RU(s.starts_at)} ${TIME_RU(s.starts_at)}`}
                          </span>
                          <span className="srow-place">
                            {showCity && cityName ? `${cityName} · ` : ""}
                            <span
                              className="srow-rooftop-link"
                              role="link"
                              tabIndex={0}
                              onClick={openRooftop}
                              onKeyDown={(e) => { if (e.key === "Enter") openRooftop(e as any); }}
                              title="Открыть страницу крыши"
                            >
                              {s.rooftop.name}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                    {screenings.length > 4 && (
                      <div className="screening-row muted" style={{ fontSize: 12 }}>+{screenings.length - 4} ещё</div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
