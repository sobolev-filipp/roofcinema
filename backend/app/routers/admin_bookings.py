"""Админ-эндпоинты: поиск пользователя, ручное создание брони (Этап D), check-in (Этап F)."""
from __future__ import annotations

import random
import secrets
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from ..db import get_db
from ..deps import require_admin_or_super, require_perm
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
from ..schemas import BookingItemIn, BookingOut
from ..utils import now_in_tz
from ..ws_manager import manager

from .bookings import _eager as booking_eager, _stock_used, _to_out as booking_to_out

router = APIRouter(prefix="/api/admin", tags=["admin-manual"])


# === поиск пользователя ===

class UserSearchHit(BaseModel):
    """Единая запись поиска: пользователь и/или совпадение в прошлых бронях."""
    source: str  # "user" или "booking_only"
    user_id: int | None
    email: str | None
    full_name: str | None
    phone: str | None
    social_url: str | None
    booking_count: int = 0
    last_booking_at: datetime | None = None


@router.get("/users/search", response_model=list[UserSearchHit])
def search_users(q: str, db: Session = Depends(get_db), _admin: User = Depends(require_perm("manage_bookings"))):
    """Поиск пользователя по email/телефону/ФИО.
    Ищем И в таблице users, И в исторических бронях (Booking) — чтобы найти даже
    тех, у кого нет аккаунта но кто уже бронировал раньше."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"

    users = (
        db.query(User)
        .filter(
            or_(
                User.email.ilike(like),
                User.phone.ilike(like),
                User.full_name.ilike(like),
            )
        )
        .order_by(User.id)
        .limit(20)
        .all()
    )

    bookings = (
        db.query(Booking)
        .filter(
            or_(
                Booking.email.ilike(like),
                Booking.phone.ilike(like),
                Booking.full_name.ilike(like),
            )
        )
        .order_by(Booking.created_at.desc())
        .limit(200)
        .all()
    )

    # Группируем: записи с user_id уходят под ключ user:{id}, прочие — под ключ email
    seen: dict[str, dict] = {}

    for u in users:
        seen[f"user:{u.id}"] = {
            "source": "user",
            "user_id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "phone": u.phone,
            "social_url": u.social_url,
            "booking_count": 0,
            "last_booking_at": None,
        }

    for b in bookings:
        if b.user_id is not None:
            key = f"user:{b.user_id}"
            if key in seen:
                row = seen[key]
                row["booking_count"] += 1
                if row["last_booking_at"] is None or b.created_at > row["last_booking_at"]:
                    row["last_booking_at"] = b.created_at
                continue
            # user_id есть, но самого юзера в выдаче нет — подтянем
            u = db.get(User, b.user_id)
            if u:
                seen[key] = {
                    "source": "user",
                    "user_id": u.id,
                    "email": u.email,
                    "full_name": u.full_name or b.full_name,
                    "phone": u.phone or b.phone,
                    "social_url": u.social_url or b.social_url,
                    "booking_count": 1,
                    "last_booking_at": b.created_at,
                }
                continue
        # без аккаунта — группируем по email
        ek = (b.email or "").lower()
        key = f"email:{ek}"
        if key in seen:
            row = seen[key]
            row["booking_count"] += 1
            if row["last_booking_at"] is None or b.created_at > row["last_booking_at"]:
                row["last_booking_at"] = b.created_at
        else:
            seen[key] = {
                "source": "booking_only",
                "user_id": None,
                "email": b.email,
                "full_name": b.full_name,
                "phone": b.phone,
                "social_url": b.social_url,
                "booking_count": 1,
                "last_booking_at": b.created_at,
            }

    result = list(seen.values())
    # сортировка: аккаунты выше, затем по числу прошлых броней
    result.sort(key=lambda r: (r["source"] != "user", -r["booking_count"], r.get("email") or ""))
    return [UserSearchHit(**r) for r in result[:20]]


# === ручное создание брони админом ===

class AdminManualBookingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    screening_id: int
    user_id: int | None = None
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=32)
    social_url: str | None = Field(default=None, max_length=512)
    items: list[BookingItemIn] = Field(min_length=1)
    note: str | None = None
    mark_as_paid: bool = False  # если админ хочет сразу пометить оплаченной


def _gen_short_code(db: Session) -> str:
    for _ in range(50):
        code = f"{random.randint(0, 999999):06d}"
        if not db.query(Booking.id).filter(Booking.short_code == code).first():
            return code
    raise RuntimeError("Не удалось сгенерировать short_code")


@router.post("/bookings/manual", response_model=BookingOut, status_code=201)
def manual_create_booking(
    payload: AdminManualBookingIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_perm("manual_booking")),
):
    """Создаёт бронь от имени пользователя. Не требует pd_consent (админ берёт ответственность).
    Если указан user_id — привязывает к существующему аккаунту, иначе бронь без юзера."""
    screening = (
        db.query(Screening)
        .options(joinedload(Screening.rooftop).joinedload(Rooftop.city))
        .filter(Screening.id == payload.screening_id)
        .first()
    )
    if not screening or not screening.is_active:
        raise HTTPException(status_code=404, detail="Показ не найден или недоступен")

    tz_name = (
        screening.rooftop.city.timezone
        if screening.rooftop and screening.rooftop.city else None
    )
    local_now = now_in_tz(tz_name)
    if screening.starts_at < local_now:
        raise HTTPException(status_code=400, detail="Этот показ уже состоялся")
    # окно бронирования для админа НЕ проверяем — это весь смысл «ручной» брони

    # проверяем существование user_id
    target_user = None
    if payload.user_id is not None:
        target_user = db.get(User, payload.user_id)
        if not target_user:
            raise HTTPException(status_code=400, detail="Указанный пользователь не найден")

    # типы мест и остатки
    sst_ids = [it.screening_seat_type_id for it in payload.items]
    ssts = db.query(ScreeningSeatType).filter(ScreeningSeatType.id.in_(sst_ids)).all()
    sst_map = {x.id: x for x in ssts}
    for it in payload.items:
        sst = sst_map.get(it.screening_seat_type_id)
        if not sst or sst.screening_id != screening.id:
            raise HTTPException(status_code=400, detail=f"Тип места #{it.screening_seat_type_id} не относится к этому показу")
        used = _stock_used(db, sst.id)
        if used + it.qty > sst.count:
            raise HTTPException(
                status_code=409,
                detail=f"Недостаточно мест «{sst.name}»: доступно {max(0, sst.count - used)}, запрошено {it.qty}",
            )

    total = sum(float(sst_map[it.screening_seat_type_id].price) * it.qty for it in payload.items)
    expires_at = datetime.utcnow() + timedelta(minutes=screening.booking_window_minutes)

    now = datetime.utcnow()
    booking = Booking(
        user_id=target_user.id if target_user else None,
        screening_id=screening.id,
        full_name=payload.full_name.strip(),
        email=str(payload.email).strip(),
        phone=payload.phone,
        social_url=payload.social_url,
        status=BookingStatus.paid.value if payload.mark_as_paid else BookingStatus.waiting_payment.value,
        expires_at=expires_at,
        total_amount=total,
        qr_token=secrets.token_urlsafe(32),
        short_code=_gen_short_code(db),
        note=payload.note,
        created_by_admin_id=admin.id,
        paid_at=now if payload.mark_as_paid else None,
    )
    db.add(booking)
    db.flush()
    for it in payload.items:
        sst = sst_map[it.screening_seat_type_id]
        db.add(BookingItem(
            booking_id=booking.id,
            screening_seat_type_id=sst.id,
            name=sst.name,
            price_each=float(sst.price),
            qty=it.qty,
        ))
    db.commit()

    # WS-событие для всех админов, смотрящих этот показ
    try:
        manager.broadcast_threadsafe(
            f"screening:{screening.id}",
            {"event": "created", "booking_id": booking.id, "screening_id": screening.id},
        )
    except Exception:
        pass

    fresh = db.query(Booking).options(*booking_eager()).filter(Booking.id == booking.id).first()
    return booking_to_out(fresh)


# =====================================================================
# === Check-in (Этап F) ===
# =====================================================================

_CHECK_IN_EAGER = [
    joinedload(Booking.screening)
    .joinedload(Screening.movie),
    joinedload(Booking.screening)
    .joinedload(Screening.rooftop)
    .joinedload(Rooftop.city),
    selectinload(Booking.items)
    .joinedload(BookingItem.screening_seat_type),
]

_PAID_FOR_CHECKIN = {
    BookingStatus.paid.value,
    BookingStatus.paid_by_balance.value,
    BookingStatus.attended.value,
}

_BOOKING_STATUS_LABELS: dict[str, str] = {
    "waiting_payment": "ожидает оплаты",
    "cancelled": "отменена",
    "expired": "истекла",
    "refund_pending": "ожидает возврата",
    "refunded": "возврат выполнен",
}


class CheckInSeatItem(BaseModel):
    name: str
    qty: int


class CheckInInfo(BaseModel):
    """Результат поиска кода — показывается пользователю до подтверждения."""
    kind: Literal["booking", "attendee"]
    booking_id: int
    attendee_id: int | None = None
    full_name: str
    guests_count: int
    seat_breakdown: list[CheckInSeatItem] = []  # типы мест: [{name, qty}]
    movie_title: str
    screening_id: int
    screening_starts_at_iso: str
    screening_starts_at_fmt: str
    rooftop_name: str
    booking_status: str
    already_attended: bool
    can_check_in: bool
    reason: str | None = None


class CheckInConfirmOut(BaseModel):
    ok: bool
    booking_id: int
    attendee_id: int | None = None
    already_attended: bool


def _load_booking_by_code(code: str, db: Session) -> tuple[Booking, BookingAttendee | None, str]:
    """Ищет бронь (или attendee) по QR-токену или short_code.
    Возвращает (booking, attendee_or_None, kind). 404 если не найдено."""
    code_upper = code.strip().upper()

    # 1. Поиск по главной брони
    b = (
        db.query(Booking)
        .options(*_CHECK_IN_EAGER)
        .filter(
            or_(
                func.upper(Booking.short_code) == code_upper,
                Booking.qr_token == code.strip(),
            )
        )
        .first()
    )
    if b:
        return b, None, "booking"

    # 2. Поиск по attendee
    a = (
        db.query(BookingAttendee)
        .options(
            joinedload(BookingAttendee.booking)
            .options(*_CHECK_IN_EAGER),
        )
        .filter(
            or_(
                func.upper(BookingAttendee.short_code) == code_upper,
                BookingAttendee.qr_token == code.strip(),
            )
        )
        .first()
    )
    if a:
        return a.booking, a, "attendee"

    raise HTTPException(status_code=404, detail="Код не найден. Проверьте правильность ввода.")


def _total_guests(booking: Booking) -> int:
    total = 0
    for item in (booking.items or []):
        cap = int(item.screening_seat_type.capacity or 1) if item.screening_seat_type else 1
        total += int(item.qty) * cap
    return max(total, 1)


def _build_check_in_info(
    booking: Booking,
    attendee: BookingAttendee | None,
    kind: str,
) -> CheckInInfo:
    screening = booking.screening
    movie = screening.movie if screening else None
    rooftop = screening.rooftop if screening else None
    city = rooftop.city if rooftop else None

    full_name = (
        (attendee.full_name or attendee.email)
        if attendee
        else (booking.full_name or booking.email or "—")
    )
    guests_count = attendee.guests_count if attendee else _total_guests(booking)
    # Разбивка по типам мест — всегда берём из booking.items (для attendee тоже показываем)
    seat_breakdown = [
        CheckInSeatItem(name=item.name, qty=int(item.qty))
        for item in (booking.items or [])
        if item.qty > 0
    ]
    movie_title = movie.title if movie else "—"
    rooftop_name = rooftop.name if rooftop else "—"
    starts_at_iso = screening.starts_at.isoformat() if screening else ""
    starts_at_fmt = screening.starts_at.strftime("%d.%m.%Y %H:%M") if screening else "—"
    screening_id = screening.id if screening else 0

    # Статус оплаты
    if booking.status not in _PAID_FOR_CHECKIN:
        label = _BOOKING_STATUS_LABELS.get(booking.status, booking.status)
        return CheckInInfo(
            kind=kind,
            booking_id=booking.id,
            attendee_id=attendee.id if attendee else None,
            full_name=full_name,
            guests_count=guests_count,
            seat_breakdown=seat_breakdown,
            movie_title=movie_title,
            screening_id=screening_id,
            screening_starts_at_iso=starts_at_iso,
            screening_starts_at_fmt=starts_at_fmt,
            rooftop_name=rooftop_name,
            booking_status=booking.status,
            already_attended=False,
            can_check_in=False,
            reason=f"Бронь «{label}» — вход невозможен.",
        )

    already_attended = booking.status == BookingStatus.attended.value

    # Временно́е окно: за 45 мин до начала и до 4 ч после
    can_check_in = True
    reason: str | None = None
    if screening:
        tz_name = city.timezone if city else None
        local_now = now_in_tz(tz_name)
        window_open = screening.starts_at - timedelta(minutes=45)
        window_close = screening.starts_at + timedelta(hours=4)

        if local_now < window_open:
            delta_sec = int((window_open - local_now).total_seconds())
            hours, rem = divmod(delta_sec, 3600)
            mins = rem // 60
            if hours > 0:
                time_str = f"{hours} ч {mins} мин" if mins else f"{hours} ч"
            else:
                time_str = f"{mins} мин"
            can_check_in = False
            reason = (
                f"Слишком рано. Вход откроется через {time_str} "
                "(проверка начинается за 45 мин до начала показа)."
            )
        elif local_now > window_close:
            can_check_in = False
            reason = "Показ завершился более 4 часов назад."

    return CheckInInfo(
        kind=kind,
        booking_id=booking.id,
        attendee_id=attendee.id if attendee else None,
        full_name=full_name,
        guests_count=guests_count,
        seat_breakdown=seat_breakdown,
        movie_title=movie_title,
        screening_id=screening_id,
        screening_starts_at_iso=starts_at_iso,
        screening_starts_at_fmt=starts_at_fmt,
        rooftop_name=rooftop_name,
        booking_status=booking.status,
        already_attended=already_attended,
        can_check_in=can_check_in,
        reason=reason,
    )


@router.get("/check-in/lookup", response_model=CheckInInfo)
def check_in_lookup(
    code: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_perm("check_in")),
):
    """Найти бронь по QR-токену или короткому коду (без побочных эффектов)."""
    booking, attendee, kind = _load_booking_by_code(code, db)
    return _build_check_in_info(booking, attendee, kind)


class CheckInConfirmPayload(BaseModel):
    code: str


@router.post("/check-in/confirm", response_model=CheckInConfirmOut)
def check_in_confirm(
    payload: CheckInConfirmPayload,
    db: Session = Depends(get_db),
    _: User = Depends(require_perm("check_in")),
):
    """Подтвердить проход (пометить бронь как attended).
    Повторный вызов для уже отмеченной брони вернёт already_attended=True без ошибки."""
    booking, attendee, _ = _load_booking_by_code(payload.code, db)

    if booking.status not in _PAID_FOR_CHECKIN:
        label = _BOOKING_STATUS_LABELS.get(booking.status, booking.status)
        raise HTTPException(status_code=400, detail=f"Бронь «{label}» — вход невозможен.")

    already = booking.status == BookingStatus.attended.value
    if not already:
        booking.status = BookingStatus.attended.value
        db.commit()
        # WS уведомление
        try:
            if booking.screening_id:
                manager.broadcast_threadsafe(
                    f"screening:{booking.screening_id}",
                    {"event": "updated", "booking_id": booking.id, "screening_id": booking.screening_id},
                )
        except Exception:
            pass

    return CheckInConfirmOut(
        ok=True,
        booking_id=booking.id,
        attendee_id=attendee.id if attendee else None,
        already_attended=already,
    )
