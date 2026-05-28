import { useEffect, useMemo, useRef, useState } from "react";
import type { Movie } from "../api";

type Props = {
  open: boolean;
  movies: Movie[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClose: () => void;
};

/** Модальное окно выбора фильма с поиском по названию.
 *  Удобнее нативного <select> когда фильмов много. */
export default function MoviePickerModal({ open, movies, selectedId, onSelect, onClose }: Props) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      // Небольшая задержка чтобы фокус не «съел» открывающий клик
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return movies;
    return movies.filter((m) => {
      return (
        m.title.toLowerCase().includes(needle)
        || (m.original_title?.toLowerCase().includes(needle) ?? false)
        || (m.year ? String(m.year).includes(needle) : false)
        || (m.director?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [movies, q]);

  if (!open) return null;

  return (
    <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ui-dialog movie-picker" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="ui-dialog-title">Выберите фильм</h3>
        <div className="field" style={{ marginTop: 4, marginBottom: 12 }}>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию / году / режиссёру"
          />
        </div>

        <div className="movie-picker-list">
          {filtered.length === 0 ? (
            <div className="empty">
              {q.trim() ? "Ничего не нашлось." : "Фильмов пока нет."}
            </div>
          ) : (
            filtered.map((m) => {
              const isSelected = m.id === selectedId;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={"movie-picker-item" + (isSelected ? " selected" : "")}
                  onClick={() => { onSelect(m.id); onClose(); }}
                >
                  <div className="movie-picker-thumb">
                    {m.poster_url
                      ? <img src={m.poster_url} alt="" loading="lazy" />
                      : <div className="poster-placeholder">{m.title[0]}</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{m.title}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {[m.year, m.duration_min ? `${m.duration_min} мин` : null, m.director]
                        .filter(Boolean).join(" · ")}
                    </div>
                    {m.age_rating && (
                      <span className="badge" style={{ marginTop: 4, fontSize: 10 }}>{m.age_rating}</span>
                    )}
                  </div>
                  {isSelected && <span style={{ color: "var(--accent)", fontSize: 18 }}>✓</span>}
                </button>
              );
            })
          )}
        </div>

        <div className="ui-dialog-actions" style={{ marginTop: 12 }}>
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
