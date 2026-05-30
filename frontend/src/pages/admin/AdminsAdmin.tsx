/**
 * Раздел управления администраторами.
 * Доступен: super_admin всегда; admin с правом manage_admins.
 *
 * Функциональность:
 *  1. Список текущих администраторов → редактирование прав, отзыв (только super_admin).
 *  2. Список активных приглашений (ожидающих принятия) с кнопкой отзыва.
 *  3. Форма создания нового приглашения: выбор прав + выбор городов/крыш.
 */
import { useEffect, useState } from "react";
import { api, type City, type Rooftop } from "../../api";
import { useAuth } from "../../auth";
import { Skeleton, Spinner } from "../../components/Loaders";
import { useUI } from "../../ui";

// ─── Типы ──────────────────────────────────────────────────────────────────

type AdminRooftopLink = {
  rooftop_id: number;
  rooftop_name: string;
  city_id: number;
  city_name: string;
};

type AdminUser = {
  id: number;
  email: string;
  full_name: string;
  permissions: string[] | null;
  rooftops: AdminRooftopLink[];
  created_at: string;
};

type InviteOut = {
  id: number;
  rooftop_id: number;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  permissions: string[] | null;
  target_rooftop_ids: number[] | null;
  created_at: string;
};

// ─── Справочник прав (должен совпадать с бэкендом) ─────────────────────────

const PERM_OPTIONS: { value: string; label: string }[] = [
  { value: "manage_rooftops",         label: "Редактировать крыши" },
  { value: "manage_movies",           label: "Добавлять / редактировать фильмы" },
  { value: "manage_screenings",       label: "Создавать / редактировать показы" },
  { value: "manage_bookings",         label: "Работать с бронированиями" },
  { value: "manage_customers",        label: "Раздел «Клиенты» (баланс, возвраты гостю)" },
  { value: "manage_transfers",        label: "Переносить брони" },
  { value: "manage_cancellations",    label: "Раздел «Отмена показа»" },
  { value: "manual_booking",          label: "Добавлять брони вручную" },
  { value: "manage_receipts",         label: "Проверять чеки" },
  { value: "manage_refunds",          label: "Работать с возвратами" },
  { value: "manage_payout_templates", label: "Управлять реквизитами" },
  { value: "manage_templates",        label: "Редактировать шаблоны сообщений" },
  { value: "check_in",                label: "Раздел «Вход» (QR-сканер)" },
  { value: "view_statistics",         label: "Смотреть статистику" },
  { value: "manage_admins",           label: "Управлять администраторами" },
];

const permLabel = (perms: string[] | null): string => {
  if (perms === null) return "Все права";
  if (perms.length === 0) return "Без прав";
  return perms
    .map((p) => PERM_OPTIONS.find((o) => o.value === p)?.label ?? p)
    .join(", ");
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });

// ─── Компонент «Редактор прав» (инлайн) ────────────────────────────────────

function PermEditor({
  initial,
  onSave,
  onCancel,
  busy,
}: {
  initial: string[] | null;
  onSave: (perms: string[] | null) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [perms, setPerms] = useState<string[] | null>(initial);

  function toggle(perm: string) {
    if (perms === null) { setPerms([perm]); return; }
    setPerms(perms.includes(perm) ? perms.filter((p) => p !== perm) : [...perms, perm]);
  }

  return (
    <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--surface2)", borderRadius: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={perms === null}
            onChange={() => setPerms(perms === null ? [] : null)}
          />
          Все права (без ограничений)
        </label>
      </div>

      {perms !== null && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 20px", marginBottom: 10 }}>
          {PERM_OPTIONS.map((p) => (
            <label key={p.value} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={perms.includes(p.value)}
                onChange={() => toggle(p.value)}
              />
              {p.label}
            </label>
          ))}
        </div>
      )}

      {perms !== null && perms.length === 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          ⚠️ Без прав администратор не увидит ни одного раздела.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className="primary" onClick={() => onSave(perms)} disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Сохраняем…" : "Сохранить права"}
        </button>
      </div>
    </div>
  );
}

// ─── Компонент «Селектор крыш по городам» ──────────────────────────────────

function RooftopSelector({
  cities,
  rooftops,
  selected,
  onChange,
}: {
  cities: City[];
  rooftops: Rooftop[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const byCity = cities.map((c) => ({
    city: c,
    items: rooftops.filter((r) => r.city_id === c.id),
  })).filter((g) => g.items.length > 0);

  function toggleRooftop(id: number) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  function toggleCity(cityId: number, items: Rooftop[]) {
    const ids = items.map((r) => r.id);
    const allSelected = ids.every((id) => selected.includes(id));
    if (allSelected) {
      onChange(selected.filter((id) => !ids.includes(id)));
    } else {
      const add = ids.filter((id) => !selected.includes(id));
      onChange([...selected, ...add]);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
      {byCity.map(({ city, items }) => {
        const allChecked = items.every((r) => selected.includes(r.id));
        const someChecked = items.some((r) => selected.includes(r.id));
        return (
          <div key={city.id}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                onChange={() => toggleCity(city.id, items)}
              />
              {city.name}
            </label>
            {items.map((r) => (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginLeft: 22, marginBottom: 2 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={() => toggleRooftop(r.id)}
                />
                {r.name}
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Главный компонент ─────────────────────────────────────────────────────

export default function AdminsAdmin() {
  const { user, hasPerm } = useAuth();
  const { confirm, notify } = useUI();
  const isSuperAdmin = user?.role === "super_admin";

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<InviteOut[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [rooftops, setRooftops] = useState<Rooftop[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Редактор прав — id открытого пользователя
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  // Форма создания инвайта
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [invitePerms, setInvitePerms] = useState<string[] | null>(null);
  const [inviteRooftops, setInviteRooftops] = useState<number[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);

  async function reload() {
    setLoading(true); setErr(null);
    try {
      const [a, inv, c, r] = await Promise.all([
        api.get<AdminUser[]>("/api/admin/admins"),
        api.get<InviteOut[]>("/api/admin/invites"),
        api.get<City[]>("/api/cities?active_only=false"),
        api.get<Rooftop[]>("/api/rooftops?active_only=false"),
      ]);
      setAdmins(a);
      setInvites(inv.filter((i) => !i.accepted_at && !i.revoked_at));
      setCities(c);
      setRooftops(r);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, []); // eslint-disable-line

  // ── Сохранить права ────────────────────────────────────────────────────

  async function savePerms(userId: number, perms: string[] | null) {
    setEditBusy(true);
    try {
      await api.patch(`/api/admin/admins/${userId}/permissions`, { permissions: perms });
      setEditingId(null);
      await reload();
      notify({ title: "Готово", message: "Права обновлены.", kind: "success" });
    } catch (e: any) { notify({ title: "Ошибка", message: e.message, kind: "error" }); }
    finally { setEditBusy(false); }
  }

  // ── Отозвать admin-статус ──────────────────────────────────────────────

  async function revokeAdmin(a: AdminUser) {
    const ok = await confirm({
      title: `Отозвать права у ${a.full_name}?`,
      message: `Пользователь ${a.email} потеряет доступ ко всем разделам админ-панели и будет понижен до обычного пользователя.`,
      confirmText: "Отозвать",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/admins/${a.id}`);
      await reload();
    } catch (e: any) { notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }

  // ── Отозвать инвайт ────────────────────────────────────────────────────

  async function revokeInvite(inv: InviteOut) {
    try {
      // Найдём rooftop_id для URL (используем primary)
      await api.post(`/api/rooftops/${inv.rooftop_id}/invites/${inv.id}/revoke`);
      await reload();
    } catch (e: any) { notify({ title: "Ошибка", message: e.message, kind: "error" }); }
  }

  // ── Создать инвайт ─────────────────────────────────────────────────────

  async function createInvite() {
    if (inviteRooftops.length === 0) {
      notify({ title: "Выберите крышу", message: "Нужно выбрать хотя бы одну крышу.", kind: "error" });
      return;
    }
    setInviteBusy(true);
    try {
      await api.post("/api/admin/invites", {
        permissions: invitePerms,
        rooftop_ids: inviteRooftops,
      });
      setShowInviteForm(false);
      setInvitePerms(null);
      setInviteRooftops([]);
      await reload();
      notify({ title: "Готово", message: "Приглашение создано.", kind: "success" });
    } catch (e: any) { notify({ title: "Ошибка", message: e.message, kind: "error" }); }
    finally { setInviteBusy(false); }
  }

  // ── Рендер ────────────────────────────────────────────────────────────

  const rooftopName = (id: number) =>
    rooftops.find((r) => r.id === id)?.name ?? `#${id}`;

  const inviteRooftopLabel = (inv: InviteOut): string => {
    const ids = inv.target_rooftop_ids ?? [inv.rooftop_id];
    return ids.map(rooftopName).join(", ");
  };

  if (loading) return (
    <div style={{ marginTop: 16 }}>
      <Skeleton variant="row" count={3} />
    </div>
  );
  if (err) return <div className="error">{err}</div>;

  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Администраторы</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Список пользователей с ролью «администратор», их права и привязанные крыши.
      </p>

      {/* ── Кнопка создания инвайта (только super_admin) ── */}
      {isSuperAdmin && (
        <div style={{ marginTop: 12, marginBottom: 16 }}>
          <button className="primary" onClick={() => setShowInviteForm((v) => !v)}>
            {showInviteForm ? "Отмена" : "+ Пригласить администратора"}
          </button>
        </div>
      )}

      {/* ── Форма создания инвайта ── */}
      {showInviteForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Новое приглашение</h3>

          {/* Права */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Права нового администратора</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={invitePerms === null}
                onChange={() => setInvitePerms(invitePerms === null ? [] : null)}
              />
              Все права (без ограничений)
            </label>
            {invitePerms !== null && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 20px", marginLeft: 4 }}>
                {PERM_OPTIONS.map((p) => (
                  <label key={p.value} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={invitePerms.includes(p.value)}
                      onChange={() =>
                        setInvitePerms(
                          invitePerms.includes(p.value)
                            ? invitePerms.filter((x) => x !== p.value)
                            : [...invitePerms, p.value]
                        )
                      }
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Крыши */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              Крыши и города{" "}
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                (выберите хотя бы одну)
              </span>
            </div>
            {cities.length === 0 ? (
              <div className="muted">Нет городов.</div>
            ) : (
              <RooftopSelector
                cities={cities}
                rooftops={rooftops}
                selected={inviteRooftops}
                onChange={setInviteRooftops}
              />
            )}
          </div>

          {invitePerms !== null && invitePerms.length === 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              ⚠️ Без прав администратор не увидит ни одного раздела.
            </div>
          )}
          {inviteRooftops.length === 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              ⚠️ Выберите хотя бы одну крышу.
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="ghost" onClick={() => setShowInviteForm(false)}>Отмена</button>
            <button
              className="primary"
              onClick={createInvite}
              disabled={inviteBusy || inviteRooftops.length === 0}
            >
              {inviteBusy ? "Создаём…" : "Создать приглашение"}
            </button>
          </div>
        </div>
      )}

      {/* ── Активные инвайты (ожидают принятия) ── */}
      {invites.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>Ожидают принятия</h3>
          <div className="cards-grid">
            {invites.map((inv) => {
              const url = `${window.location.origin}/invite/${inv.token}`;
              return (
                <div key={inv.id} className="card">
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <span className="badge">ожидает</span>
                    {isSuperAdmin && (
                      <button className="ghost" style={{ fontSize: 12 }} onClick={() => revokeInvite(inv)}>
                        Отозвать
                      </button>
                    )}
                  </div>
                  <input
                    readOnly
                    value={url}
                    style={{ fontSize: 11, marginBottom: 6 }}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="muted" style={{ fontSize: 11 }}>
                    Крыши: {inviteRooftopLabel(inv)}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    Права: {permLabel(inv.permissions)}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    до {fmt(inv.expires_at)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Список администраторов ── */}
      {admins.length === 0 ? (
        <div className="empty">Администраторов пока нет.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {admins.map((a) => (
            <div key={a.id} className="card">
              <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
                {/* Левая часть — инфо */}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{a.full_name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{a.email}</div>

                  {/* Крыши */}
                  {a.rooftops.length > 0 ? (
                    <div style={{ marginTop: 6, fontSize: 13 }}>
                      {Object.entries(
                        a.rooftops.reduce<Record<string, string[]>>((acc, lnk) => {
                          (acc[lnk.city_name] ??= []).push(lnk.rooftop_name);
                          return acc;
                        }, {})
                      ).map(([city, names]) => (
                        <div key={city}>
                          <span className="muted">{city}:</span> {names.join(", ")}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Крыши не привязаны</div>
                  )}

                  {/* Текущие права */}
                  {editingId !== a.id && (
                    <div
                      className="muted"
                      style={{ fontSize: 12, marginTop: 6, maxWidth: 400, wordBreak: "break-word" }}
                    >
                      Права: {permLabel(a.permissions)}
                    </div>
                  )}
                </div>

                {/* Правая часть — кнопки */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                  {hasPerm("manage_admins") && (
                    <button
                      className="ghost"
                      style={{ fontSize: 13 }}
                      onClick={() => {
                        if (editingId === a.id) { setEditingId(null); }
                        else { setEditingId(a.id); }
                      }}
                    >
                      {editingId === a.id ? "Закрыть" : "✏️ Изменить права"}
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button
                      className="ghost danger-on-hover"
                      style={{ fontSize: 13 }}
                      onClick={() => revokeAdmin(a)}
                    >
                      Отозвать доступ
                    </button>
                  )}
                </div>
              </div>

              {/* Инлайн-редактор прав */}
              {editingId === a.id && (
                <PermEditor
                  initial={a.permissions}
                  onSave={(perms) => savePerms(a.id, perms)}
                  onCancel={() => setEditingId(null)}
                  busy={editBusy}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
