"""Раздел брони между несколькими гостями (Этап B).
Главный бронирующий платит за всё; гости получают свои QR/коды по магической ссылке."""
from __future__ import annotations

import random
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user, get_current_user_optional
from ..email_service import send_attendee_invite
from ..models import (
    Booking,
    BookingAttendee,
    BookingItem,
    BookingStatus,
    Rooftop,
    Screening,
    ScreeningSeatType,
    User,
)
from ..schemas import (
    BookingAttendeeIn,
    BookingAttendeeOut,
    BookingOut,
    ClaimInfoOut,
)

from .bookings import _eager as booking_eager, _to_out as booking_to_out

router = APIRouter(tags=["attendees"])


_PAID_STATUSES = {BookingStatus.paid.value, BookingStatus.paid_by_balance.value, BookingStatus.attended.value}


def _gen_short_code(db: Session) -> str:
    for _ in range(50):
        code = f"{random.randint(0, 999999):06d}"
        exists_b = db.query(Booking.id).filter(Booking.short_code == code).first()
        exists_a = db.query(BookingAttendee.id).filter(BookingAttendee.short_code == code).first()
        if not exists_b and not exists_a:
            return code
    raise RuntimeError("Не удалось сгенерировать short_code")


def _total_guests_for_booking(b: Booking) -> int:
    total = 0
    for it in b.items:
        cap = it.screening_seat_type.capacity if it.screening_seat_type else 1
        total += int(it.qty) * (cap or 1)
    return total


def _absolute_claim_url(claim_token: str) -> str:
    settings = get_settings()
    return f"{settings.APP_BASE_URL.rstrip('/')}/claim/{claim_token}"


# === эндпоинты для главного бронирующего ===

@router.post(
    "/api/bookings/{booking_id}/attendees",
    response_model=BookingOut,
    status_code=201,
)
def add_attendee(
    booking_id: int,
    payload: BookingAttendeeIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = db.query(Booking).options(*booking_eager()).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.user_id != user.id:
        raise HTTPException(status_code=403, detail="Только главный бронирующий может добавлять гостей")
    if b.status in (BookingStatus.cancelled.value, BookingStatus.expired.value, BookingStatus.refunded.value):
        raise HTTPException(status_code=400, detail=f"Нельзя добавить гостей: бронь в статусе {b.status}")

    total_guests = _total_guests_for_booking(b)
    already_split = sum(a.guests_count for a in b.attendees)
    free_slots = total_guests - already_split
    if payload.guests_count > free_slots:
        raise HTTPException(
            status_code=400,
            detail=f"Можно разделить максимум {free_slots} гостей (всего в брони {total_guests}, уже разделено {already_split})",
        )

    # один email = один гость; повторный add для того же email обновляет, а не дублирует
    existing = next((a for a in b.attendees if a.email.lower() == payload.email.lower()), None)
    if existing:
        new_total = already_split - existing.guests_count + payload.guests_count
        if new_total > total_guests:
            raise HTTPException(status_code=400, detail="Сумма гостей превысит размер брони")
        existing.guests_count = payload.guests_count
        if payload.full_name:
            existing.full_name = payload.full_name
        db.commit()
        attendee = existing
    else:
        attendee = BookingAttendee(
            booking_id=b.id,
            email=str(payload.email).strip(),
            full_name=(payload.full_name or None),
            guests_count=payload.guests_count,
            qr_token=secrets.token_urlsafe(32),
            short_code=_gen_short_code(db),
            claim_token=secrets.token_urlsafe(24),
        )
        db.add(attendee)
        db.commit()
        db.refresh(attendee)

    # отправляем письмо с магической ссылкой
    is_paid = b.status in _PAID_STATUSES
    starts_text = b.screening.starts_at.strftime("%d.%m.%Y %H:%M") if b.screening else ""
    movie_title = b.screening.movie.title if b.screening and b.screening.movie else ""
    rooftop_name = b.screening.rooftop.name if b.screening and b.screening.rooftop else ""
    try:
        send_attendee_invite(
            email=attendee.email,
            movie_title=movie_title,
            starts_at_text=starts_text,
            rooftop_name=rooftop_name,
            guests_count=attendee.guests_count,
            claim_url=_absolute_claim_url(attendee.claim_token),
            short_code=attendee.short_code,
            main_booker_name=b.full_name or "",
            is_paid=is_paid,
        )
        attendee.notified_at = datetime.utcnow()
        db.commit()
    except Exception:
        # SMTP мог упасть — оставляем без notified_at, можно переотправить вручную
        pass

    fresh = db.query(Booking).options(*booking_eager()).filter(Booking.id == b.id).first()
    return booking_to_out(fresh)


@router.delete(
    "/api/bookings/{booking_id}/attendees/{attendee_id}",
    response_model=BookingOut,
)
def remove_attendee(
    booking_id: int,
    attendee_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = db.query(Booking).options(*booking_eager()).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.user_id != user.id:
        raise HTTPException(status_code=403, detail="Только главный бронирующий может удалять гостей")
    a = next((x for x in b.attendees if x.id == attendee_id), None)
    if not a:
        raise HTTPException(status_code=404, detail="Гость не найден")
    db.delete(a)
    db.commit()
    fresh = db.query(Booking).options(*booking_eager()).filter(Booking.id == b.id).first()
    return booking_to_out(fresh)


@router.post(
    "/api/bookings/{booking_id}/attendees/{attendee_id}/resend",
    response_model=BookingAttendeeOut,
)
def resend_attendee_email(
    booking_id: int,
    attendee_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = (
        db.query(Booking)
        .options(
            selectinload(Booking.attendees),
            joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(Booking.screening).joinedload(Screening.rooftop),
        )
        .filter(Booking.id == booking_id)
        .first()
    )
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.user_id != user.id:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")
    a = next((x for x in b.attendees if x.id == attendee_id), None)
    if not a:
        raise HTTPException(status_code=404, detail="Гость не найден")

    is_paid = b.status in _PAID_STATUSES
    starts_text = b.screening.starts_at.strftime("%d.%m.%Y %H:%M") if b.screening else ""
    movie_title = b.screening.movie.title if b.screening and b.screening.movie else ""
    rooftop_name = b.screening.rooftop.name if b.screening and b.screening.rooftop else ""
    try:
        send_attendee_invite(
            email=a.email,
            movie_title=movie_title,
            starts_at_text=starts_text,
            rooftop_name=rooftop_name,
            guests_count=a.guests_count,
            claim_url=_absolute_claim_url(a.claim_token),
            short_code=a.short_code,
            main_booker_name=b.full_name or "",
            is_paid=is_paid,
        )
        a.notified_at = datetime.utcnow()
        db.commit()
    except Exception:
        raise HTTPException(status_code=502, detail="Не удалось отправить письмо — проверьте SMTP")

    out = BookingAttendeeOut.model_validate(a, from_attributes=True)
    out.claim_url = f"/claim/{a.claim_token}"
    return out


# === публичный claim-эндпоинт (магическая ссылка) ===

@router.get("/api/claim/{claim_token}", response_model=ClaimInfoOut)
def get_claim_info(
    claim_token: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    a = (
        db.query(BookingAttendee)
        .options(
            joinedload(BookingAttendee.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.movie),
            joinedload(BookingAttendee.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.rooftop)
            .joinedload(Rooftop.city),
        )
        .filter(BookingAttendee.claim_token == claim_token)
        .first()
    )
    if not a:
        raise HTTPException(status_code=404, detail="Ссылка недействительна или истекла")
    b = a.booking
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.status in (BookingStatus.cancelled.value, BookingStatus.expired.value, BookingStatus.refunded.value):
        raise HTTPException(status_code=410, detail=f"Бронь больше не действительна ({b.status})")

    is_paid = b.status in _PAID_STATUSES
    s = b.screening
    return ClaimInfoOut(
        attendee_id=a.id,
        email=a.email,
        full_name=a.full_name,
        guests_count=a.guests_count,
        short_code=a.short_code if is_paid else None,
        qr_token=a.qr_token if is_paid else None,
        is_paid=is_paid,
        booking_status=b.status,
        main_booker_full_name=b.full_name or "",
        movie_title=s.movie.title if s and s.movie else "",
        movie_poster_url=(s.movie.poster_url if s and s.movie else None),
        screening_starts_at=s.starts_at if s else datetime.utcnow(),
        rooftop_name=s.rooftop.name if s and s.rooftop else "",
        city_name=(s.rooftop.city.name if s and s.rooftop and s.rooftop.city else ""),
        rooftop_address=(s.rooftop.address if s and s.rooftop and is_paid else None),
        claimed_by_user_id=a.claimed_by_user_id,
        claimed_at=a.claimed_at,
    )


@router.post("/api/claim/{claim_token}/attach", response_model=ClaimInfoOut)
def attach_claim(
    claim_token: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Привязать гостя к текущему аккаунту, чтобы билет появился в «Моих билетах»."""
    a = (
        db.query(BookingAttendee)
        .options(
            joinedload(BookingAttendee.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.movie),
            joinedload(BookingAttendee.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.rooftop)
            .joinedload(Rooftop.city),
        )
        .filter(BookingAttendee.claim_token == claim_token)
        .first()
    )
    if not a:
        raise HTTPException(status_code=404, detail="Ссылка недействительна")
    if a.claimed_by_user_id and a.claimed_by_user_id != user.id:
        raise HTTPException(status_code=409, detail="Этот билет уже привязан к другому аккаунту")
    a.claimed_by_user_id = user.id
    a.claimed_at = datetime.utcnow()
    db.commit()
    db.refresh(a)
    # вернём те же поля, что и в get_claim_info
    return get_claim_info(claim_token=claim_token, db=db, user=user)
