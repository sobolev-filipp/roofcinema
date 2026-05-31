"""Генерация QR-кодов своими силами (pure-Python segno), без сторонних сервисов.

Раньше QR брался с api.qrserver.com — у части пользователей он открывался долго
или блокировался. Теперь рисуем сами: и для встраивания в письмо, и для отдачи
через собственный эндпоинт /api/qr/{token}.png.
"""
from __future__ import annotations

import io

import segno


def qr_png_bytes(data: str, *, scale: int = 6, border: int = 2) -> bytes:
    """PNG-картинка QR-кода для произвольной строки (например, qr_token брони).

    scale — размер модуля в пикселях, border — тихая зона в модулях.
    Чёрный код на белом фоне — максимально совместимо со сканерами."""
    buf = io.BytesIO()
    segno.make(data, error="m").save(
        buf, kind="png", scale=scale, border=border, dark="#111111", light="#ffffff"
    )
    return buf.getvalue()
