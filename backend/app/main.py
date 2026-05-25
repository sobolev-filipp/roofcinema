import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine
from .email_service import send_booking_window_opened
from .models import Rooftop, Screening, ScreeningBookingNotify, User, UserRole
from .routers import (
    auth, bookings, cities, geocode, movie_search, movies, payout_templates,
    receipts, rooftops, screening_notify, screenings, seat_types, uploads, users, ws,
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
    поменять email + пароль и подтвердить новый email."""
    from datetime import datetime
    from .security import verify_password
    settings = get_settings()
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _ensure_super_admin(db)
    finally:
        db.close()
    # Запоминаем main event loop, чтобы sync-эндпоинты в threadpool могли
    # безопасно публиковать WebSocket-события через broadcast_threadsafe.
    ws_manager.set_loop(asyncio.get_running_loop())
    notify_task = asyncio.create_task(_notify_loop())
    try:
        yield
    finally:
        notify_task.cancel()
        try:
            await notify_task
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
app.include_router(receipts.router)
app.include_router(payout_templates.router)
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
