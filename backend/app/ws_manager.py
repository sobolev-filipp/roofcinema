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
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

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

    def broadcast_threadsafe(self, room: str, payload: dict[str, Any]) -> None:
        """Бросить событие из любого потока — например из sync FastAPI-эндпоинта,
        который выполняется в threadpool и не имеет running loop."""
        loop = self._loop
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(room, payload), loop)
        except RuntimeError:
            # loop уже закрыт — игнорируем
            pass


manager = WSManager()
