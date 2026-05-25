import { useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "../lib/hooks";

type Props<T extends { display: string }> = {
  value: string;
  onChange: (v: string) => void;
  onPick?: (option: T) => void;
  placeholder?: string;
  fetcher: (q: string) => Promise<T[]>;
  /** Если true — автодополнение отключено (например, пока не выбран город для адреса). */
  disabled?: boolean;
  minQuery?: number;
  /** Атрибуты для нативного input. */
  required?: boolean;
  inputId?: string;
};

export default function Autocomplete<T extends { display: string }>({
  value, onChange, onPick, placeholder, fetcher,
  disabled = false, minQuery = 2, required, inputId,
}: Props<T>) {
  const debounced = useDebouncedValue(value, 300);
  const [opts, setOpts] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Игнорируем подсказки, если пользователь только что выбрал значение из списка.
  const skipNextRef = useRef(false);

  useEffect(() => {
    if (disabled) { setOpts([]); return; }
    if (skipNextRef.current) { skipNextRef.current = false; return; }
    if (debounced.trim().length < minQuery) { setOpts([]); return; }
    let alive = true;
    setLoading(true);
    fetcher(debounced)
      .then((data) => { if (alive) { setOpts(data); setHighlighted(0); } })
      .catch(() => { if (alive) setOpts([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debounced, disabled, minQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(o: T) {
    skipNextRef.current = true;
    onChange(o.display);
    onPick?.(o);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || opts.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(opts.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(opts[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="autocomplete" ref={wrapRef}>
      <input
        id={inputId}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
      />
      {open && (loading || opts.length > 0) && (
        <div className="autocomplete-dropdown">
          {loading && opts.length === 0 && <div className="ac-loading">Поиск...</div>}
          {opts.map((o, i) => (
            <button
              type="button"
              key={i}
              className={"ac-option" + (i === highlighted ? " active" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => pick(o)}
            >
              {o.display}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
