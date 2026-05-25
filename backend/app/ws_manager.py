"""Простой in-process broadcaster для WebSocket-комнат.
Канал = строка вида 'screening:{id}'. Один процесс-uvicorn — этого достаточно для MVP."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket


class WSManager:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, room: str, ws: WebSocket) -> None:
        async with self._lock:
            self.rooms.setdefault(room, set()).add(ws)

    async def disconnect(self, room: str, ws: WebSocket) -> None:
        async with self._lock:
            self.rooms.get(room, set()).discard(ws)

    async def broadcast(self, room: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            members = list(self.rooms.get(room, set()))
        for ws in members:
            try:
                await ws.send_json(payload)
            except Exception:
                # тихо игнорируем — клиент отвалился
                pass


manager = WSManager()
