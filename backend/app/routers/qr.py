"""Отдача QR-кода брони как PNG со своего сервера (без api.qrserver.com).

GET /api/qr/{token}.png — рисует QR для произвольной строки (qr_token брони /
attendee). Эндпоинт публичный: сам по себе токен в QR — это и есть «секрет»
для входа, картинка ничего лишнего не раскрывает. Кэшируется браузером надолго,
т.к. для одного токена QR неизменен."""
from __future__ import annotations

from fastapi import APIRouter, Query, Response

from ..qr import qr_png_bytes

router = APIRouter(prefix="/api/qr", tags=["qr"])


@router.get("/{token}.png")
def qr_png(token: str, scale: int = Query(default=6, ge=1, le=20)):
    png = qr_png_bytes(token, scale=scale)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
