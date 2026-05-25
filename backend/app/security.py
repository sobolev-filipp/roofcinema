import secrets
from datetime import datetime, timedelta
from typing import Any

import bcrypt
from jose import jwt

from .config import get_settings

settings = get_settings()


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")[:72]  # bcrypt ограничен 72 байтами
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def new_jti() -> str:
    """Уникальный идентификатор сессии для JWT."""
    return secrets.token_urlsafe(24)


def create_access_token(subject: str | int, jti: str | None = None, extra: dict[str, Any] | None = None) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {"sub": str(subject), "exp": expire}
    if jti:
        payload["jti"] = jti
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
