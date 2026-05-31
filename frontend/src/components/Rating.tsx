type Props = {
  imdb?: number | null;
  kinopoisk?: number | null;
  compact?: boolean;
};

function color(value: number): string {
  if (value >= 8) return "#5fbf4b";
  if (value >= 7) return "#a7c443";
  if (value >= 6) return "#c4a743";
  return "#888";
}

export default function Rating({ imdb, kinopoisk, compact = false }: Props) {
  if (!imdb && !kinopoisk) return null;
  if (compact) {
    const value = imdb ?? kinopoisk!;
    const label = imdb ? "IMDb" : "Кп";
    return (
      <span className="rating-pill" style={{ color: color(value) }}>
        <b>{value.toFixed(1)}</b>
        <span style={{ opacity: 0.6, marginLeft: 4, fontSize: 10 }}>{label}</span>
      </span>
    );
  }
  return (
    <div className="row gap">
      {imdb != null && (
        <span className="rating-pill" style={{ color: color(imdb) }}>
          <b>{imdb.toFixed(1)}</b>
          <span style={{ opacity: 0.6, marginLeft: 4, fontSize: 11 }}>IMDb</span>
        </span>
      )}
      {kinopoisk != null && (
        <span className="rating-badge" style={{ color: color(kinopoisk) }}>
          <b>{kinopoisk.toFixed(1)}</b>
          <span style={{ opacity: 0.6, marginLeft: 4, fontSize: 11 }}>Кинопоиск</span>
        </span>
      )}
    </div>
  );
}
