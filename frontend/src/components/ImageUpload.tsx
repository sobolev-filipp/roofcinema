import { useRef, useState } from "react";
import { api, getToken } from "../api";

type Props = {
  value: string;
  onChange: (url: string) => void;
  /** Если true — поле URL спрятано, остаётся только кнопка загрузки. */
  hideUrlInput?: boolean;
  buttonLabel?: string;
};

export default function ImageUpload({ value, onChange, hideUrlInput = false, buttonLabel = "Загрузить" }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Ошибка ${res.status}`);
      onChange(data.url);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void upload(f);
  }

  return (
    <div className="image-upload">
      {!hideUrlInput && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="URL изображения или загрузить файл →"
        />
      )}
      <div className="upload-controls">
        <input ref={ref} type="file" accept="image/*" onChange={onFile} hidden />
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? "Загрузка..." : buttonLabel}
        </button>
        {value && !hideUrlInput && (
          <button type="button" className="ghost" onClick={() => onChange("")}>Очистить</button>
        )}
      </div>
      {err && <div className="error" style={{ marginTop: 6 }}>{err}</div>}
      {value && (
        <div className="upload-preview">
          <img src={value} alt="" />
        </div>
      )}
    </div>
  );
}
