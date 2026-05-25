import { useEffect, useMemo, useRef, useState } from "react";
import type { City } from "../api";

type Props = {
  cities: City[];
  value: number | null;
  onChange: (id: number | null) => void;
  allowAll?: boolean;
};

export default function CitySelector({ cities, value, onChange, allowAll = true }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value !== null ? cities.find((c) => c.id === value) ?? null : null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cities;
    return cities.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.slug.toLowerCase().includes(needle)
    );
  }, [cities, q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDoc);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(id: number | null) {
    onChange(id);
    setOpen(false);
    setQ("");
  }

  return (
    <div className="city-selector" ref={wrapRef}>
      <button type="button" className="city-trigger" onClick={() => setOpen((o) => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-7.5 8-13a8 8 0 1 0-16 0c0 5.5 8 13 8 13z" />
          <circle cx="12" cy="9" r="3" />
        </svg>
        <span>{selected ? selected.name : "Все города"}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="city-dropdown">
          <input
            ref={inputRef}
            placeholder="Поиск города..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="city-list">
            {allowAll && (
              <button type="button" className={"city-option" + (value === null ? " active" : "")} onClick={() => pick(null)}>
                Все города
              </button>
            )}
            {filtered.length === 0 && <div className="muted" style={{ padding: 10, fontSize: 13 }}>Ничего не найдено</div>}
            {filtered.map((c) => (
              <button
                type="button"
                key={c.id}
                className={"city-option" + (value === c.id ? " active" : "")}
                onClick={() => pick(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
