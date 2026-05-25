from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = "sqlite:///./roofcinema.db"
    SECRET_KEY: str = "dev-secret-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    SUPER_ADMIN_EMAIL: str = "owner@roofcinema.app"
    SUPER_ADMIN_PASSWORD: str = "changeme123"
    SUPER_ADMIN_NAME: str = "Владелец"

    # API-ключи внешних источников фильмов. Пустая строка = не настроено.
    OMDB_API_KEY: str = ""
    KINOPOISK_API_KEY: str = ""

    # SMTP для отправки писем (подтверждение email, сброс пароля).
    # Если SMTP_HOST пустой — письма выводятся в консоль (dev-режим).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@roofcinema.app"
    SMTP_USE_TLS: bool = True
    APP_BASE_URL: str = "http://127.0.0.1:5180"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
