"""Подписка пользователя на уведомление о старте бронирования показа.
Когда screening.booking_opens_at наступит — фоновая задача (см. main._notify_loop)
разошлёт письма всем подписчикам с notified_at IS NULL."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import Rooftop, Screening, ScreeningBookingNotify, User
from ..schemas import ScreeningNotifyOut
from ..utils import now_in_tz
from sqlalchemy.orm import joinedload

router = APIRouter(tags=["screening-notify"])


@router.post(
    "/api/screenings/{screening_id}/notify",
    response_model=ScreeningNotifyOut,
    status_code=201,
)
def subscribe(
    screening_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    screening = (
        db.query(Screening)
        .options(joinedload(Screening.rooftop).joinedload(Rooftop.city))
        .filter(Screening.id == screening_id)
        .first()
    )
    if not screening or not screening.is_active:
        raise HTTPException(status_code=404, detail="Показ не найден")
    if not screening.booking_opens_at:
        raise HTTPException(
            status_code=400,
            detail="Бронирование на этот показ уже открыто или не имеет даты старта — подписка не нужна",
        )
    tz_name = (
        screening.rooftop.city.timezone
        if screening.rooftop and screening.rooftop.city else None
    )
    if screening.booking_opens_at <= now_in_tz(tz_name):
        raise HTTPException(status_code=400, detail="Бронирование уже открыто")

    existing = (
        db.query(ScreeningBookingNotify)
        .filter(
            ScreeningBookingNotify.screening_id == screening_id,
            ScreeningBookingNotify.user_id == user.id,
        )
        .first()
    )
    if existing:
        # Если уже подписан и ещё не уведомлён — обновим email на актуальный и вернём
        if existing.notified_at is None:
            existing.email = user.email
            db.commit()
            return existing
        # уже уведомлён ранее — повторно подписать невозможно
        raise HTTPException(status_code=409, detail="Вы уже получили уведомление о старте по этому показу")

    sub = ScreeningBookingNotify(
        screening_id=screening_id,
        user_id=user.id,
        email=user.email,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@router.delete("/api/screenings/{screening_id}/notify", status_code=204)
def unsubscribe(
    screening_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = (
        db.query(ScreeningBookingNotify)
        .filter(
            ScreeningBookingNotify.screening_id == screening_id,
            ScreeningBookingNotify.user_id == user.id,
            ScreeningBookingNotify.notified_at.is_(None),
        )
        .first()
    )
    if sub:
        db.delete(sub)
        db.commit()


@router.get("/api/screenings/{screening_id}/notify/me", response_model=ScreeningNotifyOut | None)
def my_subscription(
    screening_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return (
        db.query(ScreeningBookingNotify)
        .filter(
            ScreeningBookingNotify.screening_id == screening_id,
            ScreeningBookingNotify.user_id == user.id,
        )
        .first()
    )
