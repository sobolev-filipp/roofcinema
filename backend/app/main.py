from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine
from .models import User, UserRole
from .routers import (
    auth, bookings, cities, geocode, movie_search, movies, payout_templates,
    rooftops, screenings, seat_types, uploads, users, ws,
)
from .security import hash_password


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _ensure_super_admin(db)
    finally:
        db.close()
    yield


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
app.include_router(bookings.router)
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
