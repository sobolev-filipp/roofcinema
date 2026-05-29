import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine
from .email_service import send_booking_window_opened, send_post_show_receipt_pending_digest, send_template_email
from .models import Booking, BookingItem, BookingStatus, BookingTransfer, LoginCode, MessageTemplate, PostShowReceipt, Rooftop, Screening, ScreeningBookingNotify, User, UserRole
from .utils import render_template
from .routers import (
    admin_bookings, admin_users, attendees, auth, bookings, cancellations, cities, geocode,
    message_templates, movie_search, movies, payout_templates, post_show_receipts, receipts,
    refunds, rooftops, screening_notify, screenings, seat_types, statistics, uploads, users, ws,
)
from .security import hash_password
from .utils import now_in_tz
from .ws_manager import manager as ws_manager
from datetime import timedelta
from sqlalchemy.orm import joinedload

import logging

log = logging.getLogger("notify-loop")


def _ensure_super_admin(db: Session) -> None:
    """Создаёт владельца, если его нет. Если пароль всё ещё дефолтный из .env —
    выставляет флаг requires_initial_setup, чтобы при первом входе заставить
    поменять email + пароль и подтвердить новый email.

    БЕЗОПАСНОСТЬ: если хотя бы один super_admin уже завершил первичную настройку
    (requires_initial_setup=False), новый пользователь с дефолтными credentials
    НЕ создаётся — даже если email в .env больше не совпадает с текущим email
    администратора (он мог сменить его через initial-setup).
    """
    from datetime import datetime
    from .security import verify_password
    settings = get_settings()

    # 1. Ищем запись с текущим email из .env
    existing = db.query(User).filter(User.email == settings.SUPER_ADMIN_EMAIL).first()
    if existing:
        if existing.role != UserRole.super_admin.value:
            existing.role = UserRole.super_admin.value
        # Если пароль всё ещё совпадает с дефолтным — требуем первичную настройку
        if verify_password(settings.SUPER_ADMIN_PASSWORD, existing.password_hash):
            existing.requires_initial_setup = True
        # placeholder email не верифицируем — это сделается при initial-setup
        if not existing.is_email_verified:
            existing.is_email_verified = True
            existing.email_verified_at = datetime.utcnow()
        db.commit()
        return

    # 2. Email из .env не найден — значит владелец уже сменил его через initial-setup.
    #    Если хоть один super_admin существует в базе, создавать новый аккаунт с
    #    дефолтными credentials категорически нельзя (дыра в безопасности).
    #    Это покрывает и случай «email сменён, но верификация ещё не пройдена».
    any_super_admin = db.query(User).filter(
        User.role == UserRole.super_admin.value,
    ).first()
    if any_super_admin:
        # Хотя бы один super_admin есть — ничего не делаем.
        return

    # 3. Нет ни одного настроенного super_admin — первый запуск, создаём владельца.
    owner = User(
        email=settings.SUPER_ADMIN_EMAIL,
        password_hash=hash_password(settings.SUPER_ADMIN_PASSWORD),
        full_name=settings.SUPER_ADMIN_NAME,
        role=UserRole.super_admin.value,
        is_email_verified=True,
        email_verified_at=datetime.utcnow(),
        requires_initial_setup=True,
    )
    db.add(owner)
    db.commit()


async def _notify_loop():
    """Каждые 60с шлём письма по подпискам, у которых наступил локальный момент
    booking_opens_at (в часовом поясе крыши).

    booking_opens_at хранится как наивное локальное время крыши, поэтому в SQL
    мы делаем грубое предварительное отсечение (utc_now + 14ч ≥ booking_opens_at —
    покрывает Камчатку UTC+12), а финальное сравнение делаем в Python с учётом
    City.timezone каждого показа."""
    from datetime import datetime
    while True:
        try:
            db = SessionLocal()
            try:
                utc_now = datetime.utcnow()
                # +14ч с запасом покрывает любой российский TZ (макс UTC+12)
                horizon = utc_now + timedelta(hours=14)
                candidates = (
                    db.query(ScreeningBookingNotify)
                    .join(Screening, ScreeningBookingNotify.screening_id == Screening.id)
                    .options(
                        joinedload(ScreeningBookingNotify.screening)
                        .joinedload(Screening.movie),
                        joinedload(ScreeningBookingNotify.screening)
                        .joinedload(Screening.rooftop)
                        .joinedload(Rooftop.city),
                    )
                    .filter(
                        ScreeningBookingNotify.notified_at.is_(None),
                        Screening.is_active.is_(True),
                        Screening.booking_opens_at.is_not(None),
                        Screening.booking_opens_at <= horizon,
                    )
                    .limit(500)
                    .all()
                )
                if candidates:
                    settings = get_settings()
                    to_commit = False
                    for s in candidates:
                        screening = s.screening
                        if not screening or not screening.movie:
                            s.notified_at = datetime.utcnow()
                            to_commit = True
                            continue
                        tz_name = (
                            screening.rooftop.city.timezone
                            if screening.rooftop and screening.rooftop.city else None
                        )
                        local_now = now_in_tz(tz_name)
                        if screening.booking_opens_at > local_now:
                            continue  # ещё не наступило локально — оставляем на следующий тик
                        link = f"{settings.APP_BASE_URL.rstrip('/')}/movies/{screening.movie_id}"
                        starts_text = screening.starts_at.strftime("%d.%m.%Y %H:%M")
                        try:
                            send_booking_window_opened(s.email, screening.movie.title, starts_text, link)
                        except Exception:
                            log.exception("notify send failed sub_id=%s", s.id)
                        s.notified_at = datetime.utcnow()
                        to_commit = True
                    if to_commit:
                        db.commit()
            finally:
                db.close()
        except Exception:
            log.exception("notify_loop iteration failed")
        await asyncio.sleep(60)


_POST_SHOW_PAID_STATUSES = ("paid", "paid_by_balance", "attended")


def _items_text_for(b: Booking) -> str:
    lines: list[str] = []
    for it in b.items:
        total = int(float(it.price_each) * it.qty)
        lines.append(f"- {it.name} ×{it.qty} — {total} ₽")
    return "\n".join(lines)


def _render_template_for_booking(db, kind: str, b: Booking, extra: dict | None = None) -> str | None:
    """Берёт дефолтный шаблон указанного kind, рендерит контекст брони. None если шаблона нет."""
    tpl = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.kind == kind, MessageTemplate.is_default.is_(True))
        .first()
    )
    if not tpl:
        tpl = db.query(MessageTemplate).filter(MessageTemplate.kind == kind).first()
    if not tpl:
        return None
    s = b.screening
    booking_link = f"{get_settings().APP_BASE_URL.rstrip('/')}/bookings/{b.id}"
    starts_at = s.starts_at.strftime("%d.%m.%Y %H:%M") if s else ""
    ends_at = ""
    if s:
        end_dt = s.ends_at
        if end_dt is None and s.movie and s.movie.duration_min:
            end_dt = s.starts_at + timedelta(minutes=int(s.movie.duration_min))
        if end_dt:
            ends_at = end_dt.strftime("%d.%m.%Y %H:%M")
    # Реквизиты для оплаты — из назначенного на показ payout_template
    payout_details = ""
    if s and s.payout_template:
        pt = s.payout_template
        lines: list[str] = []
        if pt.recipient_name:
            lines.append(f"Получатель: {pt.recipient_name}")
        if pt.card_number:
            lines.append(f"Карта: {pt.card_number}")
        if pt.phone:
            lines.append(f"Телефон (СБП): {pt.phone}")
        if pt.bank_name:
            lines.append(f"Банк: {pt.bank_name}")
        if pt.note:
            lines.append(pt.note)
        payout_details = "\n".join(lines)
    ctx = {
        "full_name": b.full_name,
        "movie": s.movie.title if (s and s.movie) else "",
        "starts_at": starts_at,
        "ends_at": ends_at,
        "rooftop": s.rooftop.name if (s and s.rooftop) else "",
        "rooftop_address": (s.rooftop.address if (s and s.rooftop) else ""),
        "city": (s.rooftop.city.name if (s and s.rooftop and s.rooftop.city) else ""),
        "items": _items_text_for(b),
        "amount": f"{int(float(b.total_amount))}",
        "expires_at": b.expires_at.strftime("%d.%m.%Y %H:%M") if b.expires_at else "",
        "booking_link": booking_link,
        "payout_details": payout_details,
    }
    if extra:
        ctx.update(extra)
    return render_template(tpl.text, ctx)


async def _payment_reminder_loop():
    """Каждые 60с: для броней в waiting_payment, у которых остаётся <25% времени
    и напоминание ещё не отправляли — шлём письмо."""
    from datetime import datetime
    while True:
        try:
            db = SessionLocal()
            try:
                now = datetime.utcnow()
                waiting = (
                    db.query(Booking)
                    .options(
                        joinedload(Booking.screening).joinedload(Screening.movie),
                        joinedload(Booking.screening).joinedload(Screening.rooftop).joinedload(Rooftop.city),
                        joinedload(Booking.screening).joinedload(Screening.payout_template),
                        selectinload(Booking.items),
                    )
                    .filter(
                        Booking.status == BookingStatus.waiting_payment.value,
                        Booking.expires_at > now,
                        Booking.payment_reminder_sent_at.is_(None),
                    )
                    .limit(500)
                    .all()
                )
                changed = False
                for b in waiting:
                    s = b.screening
                    if not s:
                        continue
                    window_min = int(s.booking_window_minutes or 120)
                    total = timedelta(minutes=window_min)
                    remaining = b.expires_at - now
                    if remaining.total_seconds() <= 0:
                        continue
                    # < 25% оставшегося времени и > 0
                    if remaining * 4 >= total:
                        continue
                    minutes_left = max(0, int(remaining.total_seconds() // 60))
                    body = _render_template_for_booking(
                        db, "payment_reminder", b,
                        extra={"minutes_left": str(minutes_left)},
                    )
                    if not body:
                        # Fallback-текст
                        body = (
                            f"Здравствуйте, {b.full_name}!\n\n"
                            f"Время на оплату брони на «{s.movie.title if s.movie else ''}» истекает скоро. "
                            f"Осталось около {int(remaining.total_seconds() // 60)} мин.\n\n"
                            f"Подтвердить оплату: {get_settings().APP_BASE_URL.rstrip('/')}/bookings/{b.id}"
                        )
                    try:
                        send_template_email(b.email, "Напоминание об оплате — Кино на крыше", body)
                        b.payment_reminder_sent_at = datetime.utcnow()
                        changed = True
                    except Exception:
                        log.exception("payment reminder send failed booking_id=%s", b.id)
                if changed:
                    db.commit()
            finally:
                db.close()
        except Exception:
            log.exception("payment_reminder_loop iteration failed")
        await asyncio.sleep(60)


# Импорт для использования внутри post_show loop без циклических импортов уже сделан выше;
# joinedload/selectinload берём из sqlalchemy.orm
from sqlalchemy.orm import selectinload  # noqa: E402


async def _post_show_receipt_loop():
    """Каждые 5 минут проверяем закончившиеся показы:
      1. Брони с прикреплённым файлом, но не отправленные → отправляем письмо с вложением.
      2. Брони без прикреплённого файла → раз в жизни шлём дайджест админам с правом manage_receipts.

    Конец показа = screening.ends_at (или starts_at + 3ч если не задан) в локальном
    времени крыши.
    """
    from datetime import datetime
    from .routers.post_show_receipts import _send_post_show_email

    while True:
        try:
            db = SessionLocal()
            try:
                settings = get_settings()
                # Берём все брони с needs_post_show_receipt=True и paid-статусом — на каждом тике
                # их немного, поэтому фильтрацию по «закончился ли показ» делаем в Python.
                candidates = (
                    db.query(Booking)
                    .options(
                        joinedload(Booking.screening).joinedload(Screening.movie),
                        joinedload(Booking.screening).joinedload(Screening.rooftop).joinedload(Rooftop.city),
                        joinedload(Booking.post_show_receipt),
                    )
                    .filter(
                        Booking.needs_post_show_receipt.is_(True),
                        Booking.status.in_(_POST_SHOW_PAID_STATUSES),
                    )
                    .limit(1000)
                    .all()
                )

                to_notify: list[Booking] = []
                for b in candidates:
                    s = b.screening
                    if s is None:
                        continue
                    tz_name = (
                        s.rooftop.city.timezone
                        if s.rooftop and s.rooftop.city else None
                    )
                    local_now = now_in_tz(tz_name)
                    # Конец показа: явный ends_at → длительность фильма → 3ч по умолчанию
                    if s.ends_at:
                        end_at = s.ends_at
                    elif s.movie and s.movie.duration_min:
                        end_at = s.starts_at + timedelta(minutes=int(s.movie.duration_min))
                    else:
                        end_at = s.starts_at + timedelta(hours=3)
                    if end_at > local_now:
                        continue  # показ ещё не закончился

                    # Показ закончился. Что делать?
                    has_file = b.post_show_receipt is not None and b.post_show_receipt.file_url
                    already_sent = (
                        b.post_show_receipt is not None
                        and b.post_show_receipt.sent_at is not None
                    )

                    if has_file and not already_sent:
                        # 1. Есть файл, не отправлен — отправляем
                        try:
                            _send_post_show_email(db, b)
                        except Exception:
                            log.exception("post-show auto-send failed booking_id=%s", b.id)
                    elif not has_file and b.post_show_admin_notified_at is None:
                        # 2. Файла нет, админов ещё не уведомляли — добавим в дайджест
                        to_notify.append(b)

                # Если есть кого включить в дайджест — соберём админов и пошлём письмо
                if to_notify:
                    admins = (
                        db.query(User)
                        .filter(User.is_active.is_(True))
                        .filter(
                            (User.role == UserRole.super_admin.value)
                            | (User.role == UserRole.admin.value)
                        )
                        .all()
                    )
                    target_admins = []
                    for a in admins:
                        if a.role == UserRole.super_admin.value:
                            target_admins.append(a)
                        elif a.permissions is None or "manage_receipts" in (a.permissions or []):
                            target_admins.append(a)

                    pending_payload = [
                        {
                            "id": b.id,
                            "full_name": b.full_name,
                            "email": b.email,
                            "movie": (b.screening.movie.title if b.screening and b.screening.movie else ""),
                            "starts_at": (
                                b.screening.starts_at.strftime("%d.%m.%Y %H:%M")
                                if b.screening else ""
                            ),
                            "rooftop": (b.screening.rooftop.name if b.screening and b.screening.rooftop else ""),
                        }
                        for b in to_notify
                    ]
                    admin_link = f"{settings.APP_BASE_URL.rstrip('/')}/admin/receipts"
                    for a in target_admins:
                        try:
                            send_post_show_receipt_pending_digest(a.email, pending_payload, admin_link)
                        except Exception:
                            log.exception("admin digest send failed user_id=%s", a.id)
                    # Помечаем брони как «админ уведомлён», чтобы не слать повторно
                    now_utc = datetime.utcnow()
                    for b in to_notify:
                        b.post_show_admin_notified_at = now_utc
                    db.commit()
            finally:
                db.close()
        except Exception:
            log.exception("post_show_receipt_loop iteration failed")
        await asyncio.sleep(300)  # раз в 5 минут — этого достаточно


def _migrate_columns() -> None:
    """Добавляет новые колонки к существующим таблицам, если их нет.
    Безопасно при повторных запусках — проверяет через inspect перед ALTER TABLE."""
    from sqlalchemy import inspect, text

    def cols(table: str) -> set[str]:
        return {c["name"] for c in inspect(engine).get_columns(table)}

    with engine.connect() as conn:
        uc = cols("users")
        if "permissions" not in uc:
            conn.execute(text("ALTER TABLE users ADD COLUMN permissions JSON"))
        ic = cols("rooftop_admin_invites")
        if "permissions" not in ic:
            conn.execute(text("ALTER TABLE rooftop_admin_invites ADD COLUMN permissions JSON"))
        if "target_rooftop_ids" not in ic:
            conn.execute(text("ALTER TABLE rooftop_admin_invites ADD COLUMN target_rooftop_ids JSON"))
        # bookings: новый флаг — нужен ли пост-чек после показа
        bc = cols("bookings")
        if "needs_post_show_receipt" not in bc:
            conn.execute(text("ALTER TABLE bookings ADD COLUMN needs_post_show_receipt BOOLEAN NOT NULL DEFAULT 0"))
        if "post_show_admin_notified_at" not in bc:
            conn.execute(text("ALTER TABLE bookings ADD COLUMN post_show_admin_notified_at DATETIME"))
        if "payment_reminder_sent_at" not in bc:
            conn.execute(text("ALTER TABLE bookings ADD COLUMN payment_reminder_sent_at DATETIME"))
        if "needs_cancel_resolution" not in bc:
            conn.execute(text("ALTER TABLE bookings ADD COLUMN needs_cancel_resolution BOOLEAN NOT NULL DEFAULT 0"))
        # screenings: ends_at + cancelled_at
        sc = cols("screenings")
        if "ends_at" not in sc:
            conn.execute(text("ALTER TABLE screenings ADD COLUMN ends_at DATETIME"))
        if "cancelled_at" not in sc:
            conn.execute(text("ALTER TABLE screenings ADD COLUMN cancelled_at DATETIME"))
        conn.commit()

    # refund_requests: возврат «с баланса» (без брони).
    # Нужно: booking_id стал nullable + появилась колонка email.
    # SQLite не умеет ALTER COLUMN — снимаем NOT NULL пересборкой таблицы.
    with engine.connect() as conn:
        rr_cols = inspect(engine).get_columns("refund_requests")
        rr_names = {c["name"] for c in rr_cols}
        booking_id_col = next((c for c in rr_cols if c["name"] == "booking_id"), None)
        need_email = "email" not in rr_names
        need_nullable = booking_id_col is not None and not booking_id_col["nullable"]
        if need_nullable:
            # Полная пересборка: новая таблица (booking_id nullable + email),
            # копирование данных, замена. Индексы пересоздаём с каноничными именами.
            conn.execute(text("PRAGMA foreign_keys=OFF"))
            conn.execute(text("""
                CREATE TABLE refund_requests_new (
                    id INTEGER NOT NULL PRIMARY KEY,
                    booking_id INTEGER,
                    email VARCHAR(255),
                    status VARCHAR(16) NOT NULL,
                    payout_token VARCHAR(64) NOT NULL,
                    amount NUMERIC(10, 2) NOT NULL,
                    payout_full_name VARCHAR(255),
                    payout_card_or_sbp VARCHAR(64),
                    payout_bank VARCHAR(120),
                    payout_comment TEXT,
                    created_by_admin_id INTEGER,
                    completed_by_admin_id INTEGER,
                    created_at DATETIME NOT NULL,
                    link_sent_at DATETIME,
                    filled_at DATETIME,
                    completed_at DATETIME,
                    FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
                    FOREIGN KEY(created_by_admin_id) REFERENCES users(id),
                    FOREIGN KEY(completed_by_admin_id) REFERENCES users(id)
                )
            """))
            conn.execute(text("""
                INSERT INTO refund_requests_new (
                    id, booking_id, status, payout_token, amount,
                    payout_full_name, payout_card_or_sbp, payout_bank, payout_comment,
                    created_by_admin_id, completed_by_admin_id,
                    created_at, link_sent_at, filled_at, completed_at
                )
                SELECT
                    id, booking_id, status, payout_token, amount,
                    payout_full_name, payout_card_or_sbp, payout_bank, payout_comment,
                    created_by_admin_id, completed_by_admin_id,
                    created_at, link_sent_at, filled_at, completed_at
                FROM refund_requests
            """))
            conn.execute(text("DROP TABLE refund_requests"))
            conn.execute(text("ALTER TABLE refund_requests_new RENAME TO refund_requests"))
            conn.execute(text("CREATE UNIQUE INDEX ix_refund_requests_booking_id ON refund_requests (booking_id)"))
            conn.execute(text("CREATE UNIQUE INDEX ix_refund_requests_payout_token ON refund_requests (payout_token)"))
            conn.execute(text("CREATE INDEX ix_refund_requests_status ON refund_requests (status)"))
            conn.execute(text("CREATE INDEX ix_refund_requests_email ON refund_requests (email)"))
            conn.execute(text("PRAGMA foreign_keys=ON"))
            conn.commit()
        elif need_email:
            # booking_id уже nullable, но колонки email ещё нет — добавляем точечно.
            conn.execute(text("ALTER TABLE refund_requests ADD COLUMN email VARCHAR(255)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_refund_requests_email ON refund_requests (email)"))
            conn.commit()

    # Разовый перенос балансов из users.balance в email_balances (по email).
    # Идемпотентно: после переноса users.balance обнуляется, повторный прогон ничего
    # не делает. Таблица email_balances уже создана через create_all к этому моменту.
    with engine.connect() as conn:
        try:
            conn.execute(text(
                "INSERT INTO email_balances (email, amount, updated_at) "
                "SELECT lower(email), balance, CURRENT_TIMESTAMP FROM users "
                "WHERE balance > 0 AND lower(email) NOT IN (SELECT email FROM email_balances)"
            ))
            conn.execute(text("UPDATE users SET balance = 0 WHERE balance > 0"))
            conn.commit()
        except Exception:
            # Если что-то пошло не так — не валим старт приложения
            conn.rollback()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_columns()
    db = SessionLocal()
    try:
        _ensure_super_admin(db)
    finally:
        db.close()
    # Запоминаем main event loop, чтобы sync-эндпоинты в threadpool могли
    # безопасно публиковать WebSocket-события через broadcast_threadsafe.
    ws_manager.set_loop(asyncio.get_running_loop())
    notify_task = asyncio.create_task(_notify_loop())
    post_show_task = asyncio.create_task(_post_show_receipt_loop())
    reminder_task = asyncio.create_task(_payment_reminder_loop())
    try:
        yield
    finally:
        for t in (notify_task, post_show_task, reminder_task):
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass


settings = get_settings()
app = FastAPI(title="Кино на крыше — API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(cities.router)
app.include_router(rooftops.router)
app.include_router(movie_search.router)
app.include_router(movies.router)
app.include_router(seat_types.router)
app.include_router(screenings.router)
app.include_router(screening_notify.router)
app.include_router(bookings.router)
app.include_router(attendees.router)
app.include_router(receipts.router)
app.include_router(payout_templates.router)
app.include_router(message_templates.router)
app.include_router(admin_bookings.router)
app.include_router(admin_users.router)
app.include_router(refunds.router)
app.include_router(post_show_receipts.router)
app.include_router(cancellations.router)
app.include_router(statistics.router)
app.include_router(uploads.router)
app.include_router(geocode.router)
app.include_router(ws.router)

# Статика для загруженных файлов
UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
def health():
    return {"status": "ok"}
