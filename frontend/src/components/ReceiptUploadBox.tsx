import { useEffect, useRef, useState } from "react";
import { getToken, type Booking, type PaymentReceipt } from "../api";
import { Spinner } from "./Loaders";

type Props = {
  booking: Booking;
  onUploaded: (b: Booking) => void;
};

const STATUS_LABEL: Record<PaymentReceipt["status"], string> = {
  pending: "На проверке",
  approved: "Подтверждён",
  rejected: "Отклонён",
};

const STATUS_COLOR: Record<PaymentReceipt["status"], string> = {
  pending: "#e9b949",
  approved: "#52c41a",
  rejected: "#ff4d4f",
};

export default function ReceiptUploadBox({ booking, onUploaded }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const last = booking.receipts[0] ?? null;  // backend сортирует desc by uploaded_at
  const pending = last && last.status === "pending" ? last : null;
  const rejected = last && last.status === "rejected" ? last : null;

  // Создаём blob-URL для превью выбранного файла (картинки). PDF просто покажем как имя.
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    if (!file.type.startsWith("image/")) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setErr(null);
    }
  }

  function clearFile() {
    setFile(null);
    setErr(null);
    if (ref.current) ref.current.value = "";
  }

  async function send() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/bookings/${booking.id}/receipts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Ошибка ${res.status}`);
      setFile(null);
      if (ref.current) ref.current.value = "";
      onUploaded(data as Booking);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="receipt-box" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <div className="payment-name" style={{ marginBottom: 8 }}>Чек об оплате</div>

      {pending && (
        <div className="hint-box" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="status-pill" style={{ borderColor: STATUS_COLOR.pending, color: STATUS_COLOR.pending }}>
              {STATUS_LABEL.pending}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              Загружен {new Date(pending.uploaded_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            <a href={pending.image_url} target="_blank" rel="noreferrer">Открыть загруженный чек ↗</a>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Ваш чек на проверке у организатора — пришлём письмо, как только подтвердят.
          </p>
        </div>
      )}

      {rejected && (
        <div className="hint-box" style={{ marginBottom: 10, borderColor: STATUS_COLOR.rejected }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="status-pill" style={{ borderColor: STATUS_COLOR.rejected, color: STATUS_COLOR.rejected }}>
              {STATUS_LABEL.rejected}
            </span>
          </div>
          {rejected.rejection_reason && (
            <p style={{ marginTop: 8, marginBottom: 0 }}>
              <b>Причина отказа:</b> {rejected.rejection_reason}
            </p>
          )}
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            Загрузите новый чек — таймер брони ещё идёт.
          </p>
        </div>
      )}

      {!pending && (
        <div className="upload-controls" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
          <input ref={ref} type="file" accept="image/*,application/pdf" onChange={onFile} hidden />

          {!file ? (
            <div className="row gap" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="primary" onClick={() => ref.current?.click()} disabled={busy}>
                📎 Выбрать файл
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                JPG/PNG/PDF до 8 МБ
              </span>
            </div>
          ) : (
            <>
              <div className="receipt-preview">
                {previewUrl ? (
                  <img src={previewUrl} alt="превью чека" />
                ) : (
                  <div className="receipt-preview-pdf">
                    <span style={{ fontSize: 32 }}>📄</span>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{file.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {(file.size / 1024).toFixed(0)} КБ · PDF
                    </div>
                  </div>
                )}
              </div>
              <div className="row gap" style={{ flexWrap: "wrap" }}>
                <button type="button" className="primary" onClick={send} disabled={busy}>
                  {busy && <Spinner />}
                  {busy ? "Отправляем..." : "Отправить чек"}
                </button>
                <button type="button" className="ghost" onClick={() => ref.current?.click()} disabled={busy}>
                  Заменить файл
                </button>
                <button type="button" className="ghost" onClick={clearFile} disabled={busy}>
                  Отмена
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
