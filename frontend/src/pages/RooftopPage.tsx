import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type RooftopPublic, type Screening } from "../api";
import LeafletMap from "../components/LeafletMap";
import { Skeleton } from "../components/Loaders";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });

export default function RooftopPage() {
  const { id } = useParams();
  const [rooftop, setRooftop] = useState<RooftopPublic | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);

  useEffect(() => {
    if (!id) return;
    api.get<RooftopPublic>(`/api/rooftops/${id}`).then(setRooftop);
    const nowIso = new Date().toISOString().slice(0, 19);
    api.get<Screening[]>(`/api/screenings?rooftop_id=${id}&date_from=${nowIso}`).then(setScreenings);
  }, [id]);

  if (!rooftop) return (
    <div className="container">
      <Skeleton variant="title" />
      <Skeleton variant="card" />
      <Skeleton variant="row" count={2} />
    </div>
  );

  const mapLat = rooftop.approx_lat;
  const mapLng = rooftop.approx_lng;

  return (
    <div className="container">
      <div className="rooftop-head">
        <div>
          <h1 style={{ margin: 0 }}>{rooftop.name}</h1>
          <div className="muted" style={{ marginTop: 4 }}>{rooftop.city_name}</div>
          {rooftop.description && (
            <p style={{ marginTop: 12, lineHeight: 1.5, maxWidth: 720 }}>{rooftop.description}</p>
          )}
        </div>
      </div>

      {mapLat !== null && mapLng !== null && (
        <div style={{ marginTop: 20 }}>
          <LeafletMap
            lat={mapLat}
            lng={mapLng}
            radiusM={rooftop.approx_radius_m}
            exact={false}
            height={320}
          />
          {rooftop.can_see_address && rooftop.address ? (
            <div className="hint-box" style={{ marginTop: 10 }}>
              <b>Адрес:</b> {rooftop.address}
            </div>
          ) : (
            <div className="hint-box muted" style={{ marginTop: 10 }}>
              На карте показана примерная область в радиусе 3 км. Точный адрес откроется автоматически
              после оплаты брони на любой показ на этой крыше.
            </div>
          )}
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>Доступные показы</h2>
      {screenings.length === 0 ? (
        <div className="empty">Ближайших показов нет.</div>
      ) : (
        <div className="cards-grid">
          {screenings.map((s) => (
            <Link to={`/movies/${s.movie.id}`} key={s.id} className="card screening-card-link">
              <div className="row gap" style={{ alignItems: "flex-start" }}>
                {s.movie.poster_url && (
                  <img
                    src={s.movie.poster_url}
                    alt=""
                    style={{ width: 60, height: 90, objectFit: "cover", borderRadius: 6 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{s.movie.title}</h3>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{fmt(s.starts_at)}</div>
                  <div style={{ marginTop: 8, fontWeight: 600 }}>от {Number(s.base_price).toFixed(0)} ₽</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
