import { useEffect, useState } from "react";

/** Возвращает значение с задержкой — для дебаунса запросов в автодополнении. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}
