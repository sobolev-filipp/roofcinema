import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type Booking,
  type City,
  type MessageTemplate,
  type Screening,
  type UserSearchHit,
} from "../../api";
import { Spinner } from "../../components/Loaders";
import { useDebouncedValue } from "../../lib/hooks";
import { useUI } from "../../ui";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

function isActiveScreening(s: Screening) {
  return s.is_active && new Date(s.starts_at).getTime() > Date.now();
}

type Qty = Record<number, number>;

const EMPTY_CONTACT = { full_name: "", email: "", phone: "", social_url: "", user_id: null as number | null };

export default function ManualBookingAdmin() {
  const { confirm, notify } = useUI();

  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [screeningSearch, setScreeningSearch] = useState("");
  const [screeningId, setScreeningId] = useState<number | null>(null);

  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [userQuery, setUserQuery] = useState("");
  const debouncedUserQuery = useDebouncedValue(userQuery, 300);
  const [hits, setHits] = useState<UserSearchHit[]>([]);
  const [showHits, setShowHits] = useState(false);

  const [qty, setQty] = useState<Qty>({});
  const [note, setNote] = useState("");
  const [markPaid, setMarkPaid] = useState(false);
  const [needsReceipt, setNeedsReceipt] = useState(false);
  const [contactBalance, setContactBalance] = useState(0);   // баланс по email контакта
  const [useBalance, setUseBalance] = useState(0);           // сколько списать с баланса

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [postPayTemplates, setPostPayTemplates] = useState<MessageTemplate[]>([]);
  const [preInfoTemplates, setPreInfoTemplates] = useState<MessageTemplate[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [preInfoCopyStatus, setPreInfoCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    api.get<Screening[]>("/api/screenings?include_inactive=true").then(setScreenings);
    api.get<MessageTemplate[]>("/api/admin/message-templates?kind=manual_booking")
      .then(setTemplates).catch(() => setTemplates([]));
    api.get<MessageTemplate[]>("/api/admin/message-templates?kind=post_payment")
      .then(setPostPayTemplates).catch(() => setPostPayTemplates([]));
    api.get<MessageTemplate[]>("/api/admin/message-templates?kind=pre_booking_info")
      .then(setPreInfoTemplates).catch(() => setPreInfoTemplates([]));
    // Cities нужны для {city} плейсхолдера — в Screening.rooftop есть только city_id
    api.get<City[]>("/api/cities").then(setCities).catch(() => setCities([]));
  }, []);

  // активные показы для пикера
  const screeningsForPicker = useMemo(() => {
    const list = screenings.filter(isActiveScreening);
    const needle = screeningSearch.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((s) =>
      s.movie.title.toLowerCase().includes(needle) ||
      s.rooftop.name.toLowerCase().includes(needle) ||
      fmt(s.starts_at).toLowerCase().includes(needle)
    );
  }, [screenings, screeningSearch]);

  const screening = useMemo(() => screenings.find((s) => s.id === screeningId) ?? null, [screenings, screeningId]);

  // поиск пользователя
  useEffect(() => {
    const q = debouncedUserQuery.trim();
    if (q.length < 2) { setHits([]); return; }
    api.get<UserSearchHit[]>(`/api/admin/users/search?q=${encodeURIComponent(q)}`)
      .then(setHits).catch(() => setHits([]));
  }, [debouncedUserQuery]);

  function selectHit(h: UserSearchHit) {
    setContact({
      full_name: h.full_name ?? "",
      email: h.email ?? "",
      phone: h.phone ?? "",
      social_url: h.social_url ?? "",
      user_id: h.user_id,
    });
    setContactBalance(h.balance || 0);  // баланс уже пришёл в результате поиска
    setShowHits(false);
    setUserQuery("");
  }

  // Подтягиваем баланс по введённому email (в т.ч. если набрали вручную, а не выбрали из поиска).
  const debouncedEmail = useDebouncedValue(contact.email.trim(), 400);
  useEffect(() => {
    const e = debouncedEmail;
    if (!e || !e.includes("@")) { setContactBalance(0); return; }
    api.get<{ balance: number }>(`/api/admin/email-balance?email=${encodeURIComponent(e)}`)
      .then((r) => setContactBalance(r.balance || 0))
      .catch(() => setContactBalance(0));
  }, [debouncedEmail]);

  function setSeat(sstId: number, val: number) {
    setQty((q) => ({ ...q, [sstId]: Math.max(0, val) }));
  }

  const totalSeats = useMemo(() => Object.values(qty).reduce((a, b) => a + b, 0), [qty]);
  const totalGuests = useMemo(() => {
    if (!screening) return 0;
    return screening.seats.reduce((sum, sst) => sum + (qty[sst.id] ?? 0) * (sst.capacity ?? 1), 0);
  }, [qty, screening]);
  const totalAmount = useMemo(() => {
    if (!screening) return 0;
    return screening.seats.reduce((sum, sst) => sum + (qty[sst.id] ?? 0) * Number(sst.price), 0);
  }, [qty, screening]);

  // Сколько реально спишется с баланса и сколько останется доплатить «живыми» деньгами
  const balanceApplied = Math.min(useBalance, contactBalance, totalAmount);
  const fullyByBalance = totalAmount > 0 && balanceApplied >= totalAmount - 1e-9;
  const externalDue = Math.max(0, totalAmount - balanceApplied);

  // Полная оплата балансом → чек не нужен, чекбокс гасим
  useEffect(() => {
    if (fullyByBalance && needsReceipt) setNeedsReceipt(false);
  }, [fullyByBalance]); // eslint-disable-line

  async function submit() {
    if (!screening) { setErr("Выберите показ"); return; }
    const items = screening.seats
      .map((sst) => ({ screening_seat_type_id: sst.id, qty: qty[sst.id] ?? 0 }))
      .filter((it) => it.qty > 0);
    if (items.length === 0) { setErr("Выберите хотя бы одно место"); return; }
    if (!contact.full_name.trim() || !contact.email.trim()) {
      setErr("Заполните ФИО и email"); return;
    }
    setBusy(true); setErr(null);
    try {
      const b = await api.post<Booking>("/api/admin/bookings/manual", {
        screening_id: screening.id,
        user_id: contact.user_id,
        full_name: contact.full_name.trim(),
        email: contact.email.trim(),
        phone: contact.phone.trim() || null,
        social_url: contact.social_url.trim() || null,
        items,
        note: note.trim() || null,
        mark_as_paid: markPaid,
        needs_post_show_receipt: needsReceipt,
        use_balance: Math.min(useBalance, contactBalance, totalAmount),
      });
      setCreatedBooking(b);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function resetAll() {
    setScreeningId(null);
    setScreeningSearch("");
    setContact(EMPTY_CONTACT);
    setUserQuery("");
    setHits([]);
    setQty({});
    setNote("");
    setMarkPaid(false);
    setNeedsReceipt(false);
    setContactBalance(0);
    setUseBalance(0);
    setCreatedBooking(null);
    setCopyStatus(null);
    setErr(null);
  }

  /** Собирает список доступных типов мест для подстановки в шаблон.
   *  Только название + цена, без остатка (чтобы не светить пользователю
   *  внутреннюю занятость). Каждая позиция на отдельной строке. */
  function buildSeatTypesText(): string {
    if (!screening) return "";
    return screening.seats
      .filter((sst) => Number(sst.count) > 0)
      .map((sst) => {
        const price = Number(sst.price).toLocaleString("ru-RU");
        return `- ${sst.name} — ${price} ₽`;
      })
      .join("\n");
  }

  // Копирование шаблона «Запрос данных у пользователя» — ДО заполнения контактов.
  // Доступные плейсхолдеры: {movie}, {starts_at}, {rooftop}, {city}, {seat_types}.
  async function copyPreInfoMessage() {
    if (!screening) return;
    const defaultTpl = preInfoTemplates.find((t) => t.is_default) ?? preInfoTemplates[0];
    if (!defaultTpl) {
      const ok = await confirm({
        title: "Нет шаблона",
        message: "Создайте шаблон типа «Запрос данных у пользователя» в разделе «Шаблоны».",
        confirmText: "Перейти к шаблонам",
        cancelText: "Закрыть",
      });
      if (ok) window.location.href = "/admin/templates";
      return;
    }
    const cityName = cities.find((c) => c.id === screening.rooftop.city_id)?.name ?? "";
    const ctx = {
      movie: screening.movie.title,
      starts_at: fmt(screening.starts_at),
      rooftop: screening.rooftop.name,
      city: cityName,
      seat_types: buildSeatTypesText(),
    };
    try {
      const res = await api.post<{ rendered: string }>("/api/admin/message-templates/preview", {
        text: defaultTpl.text,
        context: ctx,
      });
      await navigator.clipboard.writeText(res.rendered);
      setPreInfoCopyStatus("Скопировано в буфер");
      setTimeout(() => setPreInfoCopyStatus(null), 2500);
    } catch (e: any) {
      await notify({ title: "Не удалось", message: e.message, kind: "error" });
    }
  }

  const PAID_STATUSES = new Set(["paid", "paid_by_balance", "attended"]);
  const qrImageUrl = (token: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&qzone=1&color=111111&bgcolor=ffffff&data=${encodeURIComponent(token)}`;

  // Копирование сообщения пользователю. Для оплаченной брони берём шаблон
  // «После оплаты» (QR + код), для неоплаченной — «Ручное бронирование» (для оплаты).
  async function copyMessage() {
    if (!createdBooking) return;
    const isPaid = PAID_STATUSES.has(createdBooking.status);
    const pool = isPaid ? postPayTemplates : templates;
    const kindLabel = isPaid ? "После оплаты" : "Ручное бронирование";
    const defaultTpl = pool.find((t) => t.is_default) ?? pool[0];
    if (!defaultTpl) {
      const ok = await confirm({
        title: "Нет шаблона",
        message: `Создайте шаблон типа «${kindLabel}» в разделе «Шаблоны».`,
        confirmText: "Перейти к шаблонам",
        cancelText: "Закрыть",
      });
      if (ok) window.location.href = "/admin/templates";
      return;
    }
    const info = createdBooking.screening_info!;
    const ctx: Record<string, string> = {
      full_name: createdBooking.full_name,
      movie: info.movie_title,
      starts_at: fmt(info.starts_at),
      rooftop: info.rooftop_name,
      city: info.city_name,
      rooftop_address: info.rooftop_address ?? "",
      amount: Number(createdBooking.total_amount).toFixed(0),
      booking_link: `${window.location.origin}/bookings/${createdBooking.id}`,
      claim_link: "",
      short_code: createdBooking.short_code,
      qr_image_link: qrImageUrl(createdBooking.qr_token),
    };
    try {
      const res = await api.post<{ rendered: string }>("/api/admin/message-templates/preview", {
        text: defaultTpl.text,
        context: ctx,
      });
      await navigator.clipboard.writeText(res.rendered);
      setCopyStatus("Скопировано в буфер");
      setTimeout(() => setCopyStatus(null), 2500);
    } catch (e: any) {
      await notify({ title: "Не удалось", message: e.message, kind: "error" });
    }
  }

  // === результат после создания ===
  if (createdBooking) {
    const info = createdBooking.screening_info!;
    const isPaid = PAID_STATUSES.has(createdBooking.status);
    const pool = isPaid ? postPayTemplates : templates;
    const defaultTpl = pool.find((t) => t.is_default) ?? pool[0];
    const statusLabel =
      createdBooking.status === "paid_by_balance" ? "оплачено с баланса"
      : createdBooking.status === "paid" ? "оплачено"
      : createdBooking.status === "attended" ? "посетил"
      : "ждёт оплаты";
    return (
      <div>
        <h2 style={{ marginTop: 16 }}>Бронь создана ✓</h2>
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row between" style={{ flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{info.movie_title}</div>
              <div className="muted" style={{ fontSize: 13 }}>{fmt(info.starts_at)} · {info.rooftop_name}</div>
              <div style={{ marginTop: 6 }}>
                Гость: <b>{createdBooking.full_name}</b>{" "}
                <span className="muted">({createdBooking.email})</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                код брони: {createdBooking.short_code} · {Number(createdBooking.total_amount).toFixed(0)} ₽ ·{" "}
                статус: {statusLabel}
              </div>
            </div>
            <Link to={`/bookings/${createdBooking.id}`} className="btn-as-link primary">
              Открыть бронь →
            </Link>
          </div>
        </div>

        {isPaid && (
          <div className="hint-box" style={{ marginTop: 12, borderColor: "var(--ok)", background: "rgba(46,204,113,0.10)" }}>
            ✓ Бронь оплачена — письмо с QR-кодом и кодом входа уже отправлено на {createdBooking.email}.
            При необходимости можно скопировать его текст ниже и продублировать в мессенджере.
          </div>
        )}

        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>
            {isPaid ? "Сообщение «После оплаты» (QR + код)" : "Сообщение пользователю (для оплаты)"}
          </h3>
          {defaultTpl ? (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                Используется шаблон по умолчанию: <b>{defaultTpl.name}</b>.
                {isPaid
                  ? " Это то же письмо, что ушло на почту — можно скопировать и отправить вручную."
                  : " Текст скопируется с подставленными данными — отправьте в Telegram/WhatsApp/SMS."}
              </p>
              <div className="row gap" style={{ marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button className="primary" onClick={copyMessage}>📋 Скопировать сообщение</button>
                {copyStatus && <span className="badge accent">{copyStatus}</span>}
                <Link to="/admin/templates" className="ghost btn-as-link">Редактировать шаблоны</Link>
              </div>
            </>
          ) : (
            <div className="hint-box">
              Шаблона типа «{isPaid ? "После оплаты" : "Ручное бронирование"}» ещё нет.
              <Link to="/admin/templates" className="rooftop-link" style={{ marginLeft: 6 }}>
                Создать в разделе «Шаблоны» →
              </Link>
            </div>
          )}
        </div>

        <div className="row gap" style={{ marginTop: 16 }}>
          <button className="primary" onClick={resetAll}>+ Создать ещё одну</button>
        </div>
      </div>
    );
  }

  // === форма создания ===
  return (
    <div>
      <h2 style={{ marginTop: 16 }}>Ручное бронирование</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        Создайте бронь от имени пользователя — например, если он написал в личку. После создания
        вы получите готовое сообщение со ссылкой, которое можно скопировать и отправить ему.
      </p>

      {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}

      {/* 1. Выбор показа */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>1. Выберите показ</h3>
        <div className="field">
          <label>Поиск (фильм, крыша, дата)</label>
          <input
            value={screeningSearch}
            onChange={(e) => setScreeningSearch(e.target.value)}
            placeholder="Например: Лофт «Небо»"
          />
        </div>
        {screeningsForPicker.length === 0 ? (
          <div className="empty">Активных показов не найдено.</div>
        ) : (
          <div className="screening-picker">
            {screeningsForPicker.slice(0, 20).map((s) => (
              <button
                key={s.id}
                type="button"
                className={"screening-picker-item" + (s.id === screeningId ? " active" : "")}
                onClick={() => setScreeningId(s.id)}
              >
                <div className="sp-title">{s.movie.title}</div>
                <div className="sp-meta">{fmt(s.starts_at)} · {s.rooftop.name}</div>
              </button>
            ))}
            {screeningsForPicker.length > 20 && (
              <div className="muted" style={{ fontSize: 12 }}>Показано 20 из {screeningsForPicker.length}.</div>
            )}
          </div>
        )}
      </div>

      {screening && (
        <>
          {/* 2. Поиск/выбор пользователя */}
          <div className="card" style={{ marginTop: 16, position: "relative" }}>
            <h3 style={{ marginTop: 0 }}>2. Контакты пользователя</h3>
            <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Введите email/телефон/ФИО — найдём в аккаунтах и в прошлых бронях. Клик по подсказке заполнит все поля.
            </p>

            {/* Кнопка: запросить данные у пользователя (шаблон pre_booking_info) */}
            <div
              className="hint-box"
              style={{ marginBottom: 12, fontSize: 13, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <span style={{ flex: 1, minWidth: 200 }}>
                Если ещё не получили данные гостя — отправьте ему готовое сообщение с просьбой
                прислать ФИО, email и телефон.
              </span>
              <button
                type="button"
                className="primary"
                onClick={copyPreInfoMessage}
                title={preInfoTemplates.length === 0 ? "Шаблон не настроен — будет предложено создать" : undefined}
              >
                {preInfoCopyStatus ?? "📋 Запросить данные"}
              </button>
            </div>
            <div className="field" style={{ position: "relative" }}>
              <label>Поиск</label>
              <input
                value={userQuery}
                onChange={(e) => { setUserQuery(e.target.value); setShowHits(true); }}
                onFocus={() => setShowHits(true)}
                placeholder="email@... или +7..."
              />
              {showHits && hits.length > 0 && (
                <div className="user-hits">
                  {hits.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      className="user-hit"
                      onClick={() => selectHit(h)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <b>{h.full_name || h.email || "—"}</b>
                        <span className="badge accent" style={{ fontSize: 10 }}>
                          {h.source === "user" ? "Аккаунт" : "Только из броней"}
                        </span>
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {h.email}
                        {h.phone && ` · ${h.phone}`}
                      </div>
                      {h.booking_count > 0 && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          броней: {h.booking_count}
                          {h.last_booking_at && ` · последняя ${fmt(h.last_booking_at)}`}
                        </div>
                      )}
                      {h.balance > 0 && (
                        <div style={{ fontSize: 11, marginTop: 2, color: "var(--ok)", fontWeight: 600 }}>
                          баланс: {h.balance.toLocaleString("ru-RU")} ₽
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {contact.user_id && (
              <div className="hint-box" style={{ marginBottom: 12, fontSize: 13 }}>
                ✓ Привязано к аккаунту #{contact.user_id} — бронь появится в его «Мои брони».
                {" "}
                <button type="button" className="rooftop-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}
                  onClick={() => setContact({ ...contact, user_id: null })}>
                  Отвязать
                </button>
              </div>
            )}

            <div className="row gap" style={{ flexWrap: "wrap" }}>
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label>ФИО *</label>
                <input required value={contact.full_name} onChange={(e) => setContact({ ...contact, full_name: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label>Email *</label>
                <input type="email" required value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              </div>
            </div>
            <div className="row gap" style={{ flexWrap: "wrap" }}>
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label>Телефон</label>
                <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="+7..." />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label>Соцсеть</label>
                <input value={contact.social_url} onChange={(e) => setContact({ ...contact, social_url: e.target.value })} placeholder="https://t.me/..." />
              </div>
            </div>
          </div>

          {/* 3. Места */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>3. Места</h3>
            {screening.seats.length === 0 ? (
              <div className="muted">У этого показа не настроены типы мест.</div>
            ) : (
              <div className="seat-list">
                {screening.seats.map((sst) => {
                  const q = qty[sst.id] ?? 0;
                  const available = sst.seats_available ?? sst.count;
                  const cap = sst.capacity ?? 1;
                  return (
                    <div key={sst.id} className="seat-row">
                      <div className="seat-info">
                        <div className="seat-name">
                          {sst.name}
                          {cap > 1 && <span className="badge accent" style={{ marginLeft: 8, fontSize: 11 }}>{cap} гостя/место</span>}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {Number(sst.price).toFixed(0)} ₽ · осталось {available} из {sst.count}
                        </div>
                      </div>
                      <div className="qty-controls">
                        <button type="button" onClick={() => setSeat(sst.id, q - 1)} disabled={q <= 0}>−</button>
                        <span className="qty-value">{q}</span>
                        <button type="button" onClick={() => setSeat(sst.id, q + 1)} disabled={q >= available}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {totalSeats > 0 && (
              <div className="booking-total">
                <span>
                  {totalSeats} {totalSeats === 1 ? "место" : totalSeats < 5 ? "места" : "мест"}
                  {totalGuests !== totalSeats && (
                    <span className="muted" style={{ marginLeft: 6, fontSize: 13 }}>
                      · {totalGuests} {totalGuests === 1 ? "гость" : totalGuests < 5 ? "гостя" : "гостей"}
                    </span>
                  )}
                </span>
                <span className="total-amount">{totalAmount.toFixed(0)} ₽</span>
              </div>
            )}
          </div>

          {/* 4. Заметка + опции */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>4. Подтверждение</h3>

            {/* Оплата с баланса (по email). Показываем только если на балансе есть средства. */}
            {contactBalance > 0 && totalAmount > 0 && (() => {
              const maxFromBalance = Math.min(contactBalance, totalAmount);
              const applied = Math.min(useBalance, maxFromBalance);
              const left = Math.max(0, totalAmount - applied);
              return (
                <div className="hint-box" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    На балансе <b>{contactBalance.toLocaleString("ru-RU")} ₽</b> (кошелёк {contact.email}).
                    Можно оплатить часть или всё с баланса.
                  </div>
                  <div className="row gap" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div className="field" style={{ width: 180, marginBottom: 0 }}>
                      <label>Списать с баланса, ₽</label>
                      <input
                        type="number"
                        min={0}
                        max={maxFromBalance}
                        value={useBalance}
                        onChange={(e) => setUseBalance(Math.max(0, Math.min(maxFromBalance, Number(e.target.value))))}
                      />
                    </div>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setUseBalance(maxFromBalance)}
                    >
                      Всё ({maxFromBalance.toLocaleString("ru-RU")} ₽)
                    </button>
                    {useBalance > 0 && (
                      <button type="button" className="ghost" onClick={() => setUseBalance(0)}>Сбросить</button>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    {applied >= totalAmount - 1e-9
                      ? "Покрывает всю сумму — бронь сразу станет «оплачено с баланса»."
                      : `С баланса: ${applied.toLocaleString("ru-RU")} ₽ · к доплате: ${left.toLocaleString("ru-RU")} ₽`}
                  </div>
                </div>
              );
            })()}

            <div className="field">
              <label>Внутренняя заметка (только для админа)</label>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} />
              <span>Сразу пометить оплаченной (оплата уже получена другим способом)</span>
            </label>
            <label className="checkbox" style={fullyByBalance ? { opacity: 0.5 } : undefined}>
              <input
                type="checkbox"
                checked={needsReceipt && !fullyByBalance}
                disabled={fullyByBalance}
                onChange={(e) => setNeedsReceipt(e.target.checked)}
              />
              <span>
                Нужен чек на email после показа
                {fullyByBalance ? (
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                    — оплата полностью с баланса, чек не требуется
                  </span>
                ) : externalDue < totalAmount && externalDue > 0 ? (
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                    — чек будет на доплаченную сумму {externalDue.toLocaleString("ru-RU")} ₽ (без части с баланса)
                  </span>
                ) : (
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                    — появится в разделе «Чеки → Чеки для отправки»
                  </span>
                )}
              </span>
            </label>
            <div className="row gap" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button className="ghost" onClick={resetAll} disabled={busy}>Очистить</button>
              <button className="primary" onClick={submit} disabled={busy || totalSeats === 0}>
                {busy && <Spinner />}
                {busy ? "Создание..." : `Создать бронь на ${totalAmount.toFixed(0)} ₽`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
