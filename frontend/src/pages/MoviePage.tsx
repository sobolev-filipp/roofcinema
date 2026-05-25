import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type City, type Movie, type Screening } from "../api";
import BookingForm from "../components/BookingForm";
import Rating from "../components/Rating";
import { toEmbedUrl } from "../lib/embed";

let _citiesCache: Promise<City[]> | null = null;
function loadCities() {
  if (!_citiesCache) _citiesCache = api.get<City[]>("/api/cities");
  return _citiesCache;
}

function CityForRooftop({ cityId }: { rooftopId: number; cityId: number }) {
  const [name, setName] = useState<string>("");
  useEffect(() => {
    let alive = true;
    loadCities().then((cs) => {
      if (!alive) return;
      const c = cs.find((x) => x.id === cityId);
      if (c) setName(c.name);
    });
    return () => { alive = false; };
  }, [cityId]);
  return <span>{name || "—"}</span>;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

export default function MoviePage() {
  const { id } = useParams();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [bookingForScreening, setBookingForScreening] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<Movie>(`/api/movies/${id}`).then(setMovie);
    api.get<Screening[]>(`/api/screenings?movie_id=${id}`).then(setScreenings);
  }, [id]);

  if (!movie) return <div className="container"><div className="empty">Загрузка...</div></div>;

  const trailer = toEmbedUrl(movie.trailer_url);

  return (
    <div className="container">
      <div className="movie-hero">
        {movie.poster_url ? (
          <img src={movie.poster_url} alt="" className="movie-hero-poster" />
        ) : (
          <div className="movie-hero-poster poster-placeholder">{movie.title[0]}</div>
        )}
        <div className="movie-hero-info">
          <h1 style={{ margin: 0 }}>{movie.title}</h1>
          {movie.original_title && <div className="muted">{movie.original_title}</div>}
          <div className="muted" style={{ marginTop: 8 }}>
            {[movie.year, movie.duration_min ? `${movie.duration_min} мин` : null, movie.age_rating, movie.genres]
              .filter(Boolean).join(" · ")}
          </div>
          {movie.director && <div className="muted" style={{ marginTop: 6 }}>Режиссёр: {movie.director}</div>}
          <div style={{ marginTop: 14 }}>
            <Rating imdb={movie.imdb_rating} kinopoisk={movie.kinopoisk_rating} />
          </div>
          {movie.description && <p style={{ marginTop: 16, lineHeight: 1.5 }}>{movie.description}</p>}

          <h3 style={{ marginTop: 22, marginBottom: 12 }}>Ближайшие показы</h3>
          {screenings.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>Показов пока нет.</div>
          ) : (
            <div className="screenings-list">
              {screenings.map((s) => {
                const active = s.seats.filter((sst) => sst.count > 0);
                const minPrice = active.length > 0 ? Math.min(...active.map((sst) => Number(sst.price))) : Number(s.base_price);
                const isExpanded = bookingForScreening === s.id;
                const future = new Date(s.starts_at) > new Date();
                return (
                  <div key={s.id} className={"card screening-block" + (isExpanded ? " expanded" : "")}>
                    <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{fmt(s.starts_at)}</div>
                        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                          <CityForRooftop rooftopId={s.rooftop.id} cityId={s.rooftop.city_id} />
                          {" · "}
                          <Link to={`/rooftops/${s.rooftop.id}`} className="rooftop-link">
                            {s.rooftop.name}
                          </Link>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>от {minPrice.toFixed(0)} ₽</div>
                        {future ? (
                          <button
                            className={isExpanded ? "ghost" : "primary"}
                            style={{ marginTop: 8 }}
                            onClick={() => setBookingForScreening(isExpanded ? null : s.id)}
                          >
                            {isExpanded ? "Скрыть" : "Забронировать"}
                          </button>
                        ) : (
                          <button className="ghost" style={{ marginTop: 8 }} disabled>Показ прошёл</button>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                        <BookingForm screening={s} onCancel={() => setBookingForScreening(null)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {movie.stills && movie.stills.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Кадры</h2>
          <div className="stills-scroll">
            {movie.stills.map((s) => (
              <img key={s.id} src={s.image_url} alt="" loading="lazy" />
            ))}
          </div>
        </>
      )}

      {trailer && (
        <>
          <h2 style={{ marginTop: 32 }}>Трейлер</h2>
          <div className="trailer-wrap">
            <iframe
              src={trailer}
              title="Трейлер"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </>
      )}

    </div>
  );
}
