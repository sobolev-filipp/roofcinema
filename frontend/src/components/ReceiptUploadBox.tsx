import { useRef, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const last = booking.receipts[0] ?? null;  // backend сортирует desc by uploaded_at
  const pending = last && last.status === "pending" ? last : null;
  const rejected = last && last.status === "rejected" ? last : null;

  async function upload(file: File) {
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
      onUploaded(data as Booking);
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
        <div className="upload-controls">
          <input ref={ref} type="file" accept="image/*,application/pdf" onChange={onFile} hidden />
          <button type="button" className="primary" onClick={() => ref.current?.click()} disabled={busy}>
            {busy && <Spinner />}
            {busy ? "Загрузка..." : (rejected ? "Загрузить новый чек" : "Загрузить чек об оплате")}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            JPG/PNG/PDF до 8 МБ
          </span>
        </div>
      )}

      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
