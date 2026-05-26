import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import ImageUpload from "../components/ImageUpload";
import { Spinner } from "../components/Loaders";

export default function EditProfilePage() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    full_name: "", avatar_url: "", phone: "", social_url: "", bio: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      full_name: user.full_name ?? "",
      avatar_url: user.avatar_url ?? "",
      phone: user.phone ?? "",
      social_url: user.social_url ?? "",
      bio: user.bio ?? "",
    });
  }, [user]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setInfo(null);
    try {
      await api.patch("/api/users/me", {
        full_name: form.full_name || null,
        avatar_url: form.avatar_url || null,
        phone: form.phone || null,
        social_url: form.social_url || null,
        bio: form.bio || null,
      });
      await refresh();
      setInfo("Сохранено");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <button className="ghost" onClick={() => nav("/profile")}>← К профилю</button>
      <h1 style={{ marginTop: 12 }}>Редактирование профиля</h1>

      {err && <div className="error">{err}</div>}
      {info && <div className="hint-box" style={{ marginBottom: 12 }}>{info}</div>}

      <form onSubmit={save} className="card">
        <div className="field">
          <label>Аватар</label>
          <ImageUpload value={form.avatar_url} onChange={(v) => setForm({ ...form, avatar_url: v })} />
        </div>
        <div className="field">
          <label>ФИО</label>
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div className="row gap" style={{ flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>Телефон</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>Соцсеть</label>
            <input placeholder="https://t.me/..." value={form.social_url} onChange={(e) => setForm({ ...form, social_url: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>О себе</label>
          <textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </div>
        <div className="row gap" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={() => nav("/profile")}>Отмена</button>
          <button className="primary" type="submit" disabled={busy}>
            {busy && <Spinner />}
            {busy ? "Сохраняем..." : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}
