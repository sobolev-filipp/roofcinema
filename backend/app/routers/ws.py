"""WebSocket для реал-тайм обновлений.
Канал screening:{id} — события create/update/delete по бронированиям конкретного показа.
Доступ только для админов: токен передаётся в query-параметре ?token=..."""
from __future__ import annotations

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import RooftopAdmin, Screening, User, UserRole
from ..security import decode_token
from ..ws_manager import manager

router = APIRouter()


def _auth_user_from_token(token: str | None, db: Session) -> User | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        return None
    user = db.get(User, user_id)
    if user and user.is_active:
        return user
    return None


def _can_view_screening_bookings(db: Session, user: User, screening_id: int) -> bool:
    if user.role == UserRole.super_admin.value:
        return True
    if user.role != UserRole.admin.value:
        return False
    scr = db.get(Screening, screening_id)
    if not scr:
        return False
    link = (
        db.query(RooftopAdmin)
        .filter(
            RooftopAdmin.user_id == user.id,
            RooftopAdmin.rooftop_id == scr.rooftop_id,
            RooftopAdmin.can_manage_bookings.is_(True),
        )
        .first()
    )
    return link is not None


@router.websocket("/api/ws/screenings/{screening_id}/bookings")
async def ws_screening_bookings(ws: WebSocket, screening_id: int, token: str | None = Query(default=None)):
    db = SessionLocal()
    try:
        user = _auth_user_from_token(token, db)
        if not user or not _can_view_screening_bookings(db, user, screening_id):
            await ws.close(code=4401)
            return
    finally:
        db.close()

    room = f"screening:{screening_id}"
    await ws.accept()
    await manager.connect(room, ws)
    try:
        while True:
            # клиент может пинговать или присылать что угодно — нам не нужно реагировать
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room, ws)
