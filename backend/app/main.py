import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine
from .email_service import send_booking_window_opened, send_post_show_receipt_pending_digest
from .models import Booking, BookingTransfer, LoginCode, PostShowReceipt, Rooftop, Screening, ScreeningBookingNotify, User, UserRole
from .routers import (
    admin_bookings, admin_users, attendees, auth, bookings, cities, geocode, message_templates,
    movie_search, movies, payout_templates, post_show_receipts, receipts, refunds, rooftops,
    screening_notify, screenings, seat_types, statistics, uploads, users, ws,
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
        # screenings: ends_at — локальное наивное время окончания показа
        sc = cols("screenings")
        if "ends_at" not in sc:
            conn.execute(text("ALTER TABLE screenings ADD COLUMN ends_at DATETIME"))
        conn.commit()


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
    try:
        yield
    finally:
        for t in (notify_task, post_show_task):
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
