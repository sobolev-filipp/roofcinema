import { useEffect, useRef } from "react";

type Props = {
  length: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

export default function PinInput({ length, value, onChange, onComplete, disabled, autoFocus }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function setDigit(idx: number, digit: string) {
    const clean = digit.replace(/\D/g, "");
    const next = value.split("");
    while (next.length < length) next.push("");
    next[idx] = clean.slice(-1);
    const joined = next.join("").slice(0, length);
    onChange(joined);
    if (clean) {
      const ni = idx + 1;
      if (ni < length) refs.current[ni]?.focus();
    }
    if (joined.length === length && joined.split("").every(Boolean)) onComplete?.(joined);
  }

  function onKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (value[idx]) {
        // удаляем текущую цифру
        const next = value.split("");
        next[idx] = "";
        onChange(next.join("").slice(0, length));
      } else if (idx > 0) {
        refs.current[idx - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      refs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < length - 1) {
      refs.current[idx + 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!text) return;
    e.preventDefault();
    onChange(text);
    if (text.length === length) {
      refs.current[length - 1]?.focus();
      onComplete?.(text);
    } else {
      refs.current[text.length]?.focus();
    }
  }

  return (
    <div className="pin-input" onPaste={onPaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[i] ?? ""}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          disabled={disabled}
          aria-label={`Цифра ${i + 1} из ${length}`}
        />
      ))}
    </div>
  );
}
