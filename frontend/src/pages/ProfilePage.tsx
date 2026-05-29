import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Spinner } from "../components/Loaders";
import { useTheme } from "../theme";
import { useUI } from "../ui";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Владелец",
  admin: "Администратор",
  user: "Пользователь",
};

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const { theme, setTheme } = useTheme();
  const { notify } = useUI();
  const [refundOpen, setRefundOpen] = useState(false);
  if (!user) return null;

  const balance = Number(user.balance);

  const initials = (user.full_name || user.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1>Профиль</h1>

      {!user.is_email_verified && (
        <div className="verify-banner">
          <div>
            <b>Email не подтверждён.</b>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Подтвердите {user.email}, чтобы защитить аккаунт и восстановить пароль при необходимости.
            </div>
          </div>
          <Link to="/verify-email" className="btn-as-link primary btn-sm">Подтвердить</Link>
        </div>
      )}

      <div className="card profile-head">
        <div className="profile-avatar">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" />
          ) : (
            <span>{initials || "—"}</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{user.full_name || "Без имени"}</h2>
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{user.email}</div>
          <div style={{ marginTop: 8 }}>
            <span className="badge accent">{ROLE_LABEL[user.role] ?? user.role}</span>
          </div>
          {user.bio && <p style={{ marginTop: 12 }}>{user.bio}</p>}
          {(user.phone || user.social_url) && (
            <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              {user.phone && <span>{user.phone}</span>}
              {user.phone && user.social_url && <span> · </span>}
              {user.social_url && <a href={user.social_url} target="_blank" rel="noopener" className="rooftop-link">{user.social_url}</a>}
            </div>
          )}
        </div>
        <Link to="/profile/edit" className="btn-as-link">Редактировать</Link>
      </div>

      <div className="profile-stats">
        <div className="card stat-card">
          <div className="stat-label">Баланс</div>
          <div className="stat-value">{balance.toFixed(0)} <span style={{ fontSize: 16 }}>₽</span></div>
          <div className="muted" style={{ fontSize: 12 }}>Можно использовать для оплаты броней</div>
          {balance > 0 && (
            <button
              type="button"
              className="ghost btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => setRefundOpen(true)}
            >
              Запросить возврат средств
            </button>
          )}
        </div>
      </div>

      {refundOpen && (
        <BalanceRefundModal
          balance={balance}
          onClose={() => setRefundOpen(false)}
          onDone={async () => {
            setRefundOpen(false);
            await refresh();
            await notify({
              title: "Запрос отправлен",
              message: "Заявка на возврат средств передана организатору. Деньги спишутся с баланса и будут переведены по указанным реквизитам.",
              kind: "success",
            });
          }}
        />
      )}

      <div className="profile-links">
        <Link to="/bookings" className="profile-link-card card">
          <div>
            <div className="pl-title">Мои бронирования</div>
            <div className="muted" style={{ fontSize: 13 }}>Активные с таймером и история отмен</div>
          </div>
          <span className="pl-arrow">→</span>
        </Link>
        <Link to="/profile/tickets" className="profile-link-card card">
          <div>
            <div className="pl-title">Мои QR-коды</div>
            <div className="muted" style={{ fontSize: 13 }}>Оплаченные брони с QR для входа</div>
          </div>
          <span className="pl-arrow">→</span>
        </Link>
        <Link to="/profile/security" className="profile-link-card card">
          <div>
            <div className="pl-title">Безопасность</div>
            <div className="muted" style={{ fontSize: 13 }}>Пароль и активные сессии</div>
          </div>
          <span className="pl-arrow">→</span>
        </Link>

        {/* Внешний вид — переключатель темы (настройка, не ссылка) */}
        <div className="card profile-setting-card">
          <div style={{ flex: 1 }}>
            <div className="pl-title">Внешний вид</div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              Цветовая тема приложения
            </div>
            <div className="seg" style={{ maxWidth: 320 }}>
              <button
                type="button"
                className={theme === "dark" ? "active" : ""}
                onClick={() => setTheme("dark")}
              >
                🌙 Тёмная
              </button>
              <button
                type="button"
                className={theme === "light" ? "active" : ""}
                onClick={() => setTheme("light")}
              >
                ☀ Светлая
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BalanceRefundModal({
  balance, onClose, onDone,
}: {
  balance: number;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { notify } = useUI();
  const [fullName, setFullName] = useState("");
  const [card, setCard] = useState("");
  const [bank, setBank] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!fullName.trim() || card.trim().length < 4) {
      await notify({ title: "Заполните поля", message: "Укажите ФИО и номер карты / телефон СБП.", kind: "error" });
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/me/balance-refund-request", {
        payout_full_name: fullName.trim(),
        payout_card_or_sbp: card.trim(),
        payout_bank: bank.trim() || null,
        payout_comment: comment.trim() || null,
      });
      await onDone();
    } catch (e: any) {
      await notify({ title: "Не удалось отправить", message: e.message, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ui-dialog" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="ui-dialog-title">Возврат средств с баланса</h3>
        <div className="ui-dialog-body">
          К возврату: <b>{balance.toFixed(0)} ₽</b>. Укажите реквизиты — организатор переведёт
          деньги вручную. После отправки сумма спишется с баланса.
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>ФИО получателя *</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иванов Иван Иванович" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Карта или телефон СБП *</label>
            <input value={card} onChange={(e) => setCard(e.target.value)} placeholder="2200 1234 5678 9012 или +7 999..." />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Банк (необязательно)</label>
            <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Сбербанк, Тинькофф..." />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Комментарий (необязательно)</label>
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: переводить на СБП" />
          </div>
        </div>
        <div className="ui-dialog-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="primary" onClick={submit} disabled={busy}>
            {busy && <Spinner />}Запросить возврат
          </button>
        </div>
      </div>
    </div>
  );
}
