"""Бронирования: создание с таймером, авто-истечение, отмена."""
from __future__ import annotations

import random
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from ..db import get_db
from ..deps import get_current_user, require_admin_or_super, require_perm
from ..models import (
    Booking,
    BookingItem,
    BookingStatus,
    PaymentReceipt,
    PaymentReceiptStatus,
    RefundRequest,
    RefundRequestStatus,
    Rooftop,
    RooftopAdmin,
    Screening,
    ScreeningSeatType,
    User,
    UserRole,
)
from ..schemas import BookingCreateIn, BookingOut, BookingScreeningInfo, RefundBasicOut
from ..utils import now_in_tz
from ..ws_manager import manager


def _broadcast(screening_id: int, event: str, booking_id: int) -> None:
    """Бросает событие в WS-комнату показа. Работает и из sync-эндпоинтов FastAPI
    (которые выполняются в threadpool и не имеют running loop)."""
    payload = {"event": event, "booking_id": booking_id, "screening_id": screening_id}
    manager.broadcast_threadsafe(f"screening:{screening_id}", payload)

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


# === вспомогательные ===

def _gen_short_code(db: Session) -> str:
    """6-значный код для ручной проверки на входе. Гарантированно уникален."""
    for _ in range(50):
        code = f"{random.randint(0, 999999):06d}"
        if not db.query(Booking.id).filter(Booking.short_code == code).first():
            return code
    raise RuntimeError("Не удалось сгенерировать short_code")


def _expire_overdue(db: Session) -> None:
    """Помечает все waiting_payment с истёкшим expires_at как expired.

    Брони с pending-чеком НЕ истекают: их таймер «на паузе» до решения админа.
    Эффективно пауза реализована тем, что при reject мы продлеваем expires_at
    на длительность проверки чека (см. receipts.reject_receipt)."""
    now = datetime.utcnow()
    overdue = (
        db.query(Booking)
        .filter(
            Booking.status == BookingStatus.waiting_payment.value,
            Booking.expires_at < now,
            ~Booking.receipts.any(PaymentReceipt.status == PaymentReceiptStatus.pending.value),
        )
        .all()
    )
    if not overdue:
        return
    for b in overdue:
        b.status = BookingStatus.expired.value
    db.commit()


def _stock_used(db: Session, sst_id: int) -> int:
    """Сколько мест данного ScreeningSeatType уже занято активными бронями."""
    now = datetime.utcnow()
    q = (
        db.query(func.coalesce(func.sum(BookingItem.qty), 0))
        .join(Booking, BookingItem.booking_id == Booking.id)
        .filter(BookingItem.screening_seat_type_id == sst_id)
        .filter(
            or_(
                Booking.status.in_([
                    BookingStatus.paid.value,
                    BookingStatus.attended.value,
                    BookingStatus.paid_by_balance.value,
                ]),
                and_(
                    Booking.status == BookingStatus.waiting_payment.value,
                    Booking.expires_at > now,
                ),
            )
        )
    )
    return int(q.scalar() or 0)


def _eager() -> list:
    return [
        joinedload(Booking.screening).joinedload(Screening.movie),
        joinedload(Booking.screening).joinedload(Screening.rooftop).joinedload(Rooftop.city),
        selectinload(Booking.items).joinedload(BookingItem.screening_seat_type),
        selectinload(Booking.receipts),
        selectinload(Booking.attendees),
        joinedload(Booking.refund_request),
    ]


_REVEALS_ADDRESS = {
    BookingStatus.paid.value,
    BookingStatus.attended.value,
    BookingStatus.paid_by_balance.value,
}


def _to_out(b: Booking) -> BookingOut:
    """Сериализация с заполненным screening_info, attendees[].claim_url и total_guests.
    Точный адрес крыши раскрываем только если бронь оплачена/посещена."""
    s = b.screening
    info = None
    if s is not None:
        reveal_address = b.status in _REVEALS_ADDRESS
        info = BookingScreeningInfo(
            id=s.id,
            starts_at=s.starts_at,
            movie_id=s.movie_id,
            movie_title=s.movie.title if s.movie else "",
            movie_poster_url=(s.movie.poster_url if s.movie else None),
            rooftop_id=s.rooftop_id,
            rooftop_name=s.rooftop.name if s.rooftop else "",
            city_name=(s.rooftop.city.name if s.rooftop and s.rooftop.city else ""),
            rooftop_address=(s.rooftop.address if s.rooftop and reveal_address else None),
        )
    # total_guests: сумма qty * capacity по items (snapshot capacity на момент брони
    # хранится в ScreeningSeatType — догружаем через relationship; если потеряли, считаем 1).
    total_guests = 0
    for it in b.items:
        cap = 1
        if it.screening_seat_type is not None:
            cap = it.screening_seat_type.capacity or 1
        total_guests += int(it.qty) * cap

    out = BookingOut.model_validate(b, from_attributes=True)
    out.screening_info = info
    out.total_guests = total_guests
    for a_out, a in zip(out.attendees, b.attendees):
        a_out.claim_url = f"/claim/{a.claim_token}"
    if b.refund_request:
        out.refund_request = RefundBasicOut.model_validate(b.refund_request, from_attributes=True)
    return out


# === эндпоинты ===

def _admin_can_manage_screening(db: Session, user: User, screening_id: int) -> bool:
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


@router.get("", response_model=list[BookingOut])
def list_bookings_admin(
    screening_id: int | None = None,
    status: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_perm("manage_bookings")),
):
    """Админ-листинг бронирований с фильтрами."""
    _expire_overdue(db)
    query = db.query(Booking).options(*_eager())
    if screening_id is not None:
        if not _admin_can_manage_screening(db, user, screening_id):
            raise HTTPException(status_code=403, detail="Нет прав на бронирования этого показа")
        query = query.filter(Booking.screening_id == screening_id)
    elif user.role == UserRole.admin.value:
        # обычный админ видит только брони своих крыш
        rooftop_ids = [
            r.rooftop_id for r in db.query(RooftopAdmin).filter(
                RooftopAdmin.user_id == user.id, RooftopAdmin.can_manage_bookings.is_(True)
            ).all()
        ]
        if not rooftop_ids:
            return []
        query = query.join(Screening, Booking.screening_id == Screening.id).filter(Screening.rooftop_id.in_(rooftop_ids))
    if status:
        query = query.filter(Booking.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter((Booking.full_name.ilike(like)) | (Booking.email.ilike(like)) | (Booking.short_code.ilike(like)))
    bookings = query.order_by(Booking.created_at.desc()).limit(500).all()
    return [_to_out(b) for b in bookings]


@router.get("/me", response_model=list[BookingOut])
def list_my_bookings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    status: str | None = None,
):
    _expire_overdue(db)
    q = db.query(Booking).options(*_eager()).filter(Booking.user_id == user.id)
    if status:
        q = q.filter(Booking.status == status)
    bookings = q.order_by(Booking.created_at.desc()).all()
    return [_to_out(b) for b in bookings]


@router.get("/{booking_id}", response_model=BookingOut)
def get_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _expire_overdue(db)
    b = db.query(Booking).options(*_eager()).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    is_owner = b.user_id == user.id
    is_admin = user.role in (UserRole.super_admin.value, UserRole.admin.value)
    if not (is_owner or is_admin):
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")
    return _to_out(b)


@router.post("", response_model=BookingOut, status_code=201)
def create_booking(
    payload: BookingCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not payload.pd_consent:
        raise HTTPException(status_code=400, detail="Требуется согласие на обработку персональных данных")

    screening = (
        db.query(Screening)
        .options(joinedload(Screening.rooftop).joinedload(Rooftop.city))
        .filter(Screening.id == payload.screening_id)
        .first()
    )
    if not screening or not screening.is_active:
        raise HTTPException(status_code=404, detail="Показ не найден или недоступен")
    # screening.starts_at/booking_opens_at/booking_closes_at — это локальное
    # наивное время в часовом поясе крыши, сравниваем с «локальным сейчас», а не utcnow.
    tz_name = (
        screening.rooftop.city.timezone
        if screening.rooftop and screening.rooftop.city else None
    )
    local_now = now_in_tz(tz_name)
    if screening.starts_at < local_now:
        raise HTTPException(status_code=400, detail="Этот показ уже состоялся")
    if screening.booking_opens_at and local_now < screening.booking_opens_at:
        raise HTTPException(
            status_code=400,
            detail=f"Бронирование откроется {screening.booking_opens_at.strftime('%d.%m.%Y в %H:%M')}",
        )
    close_at = screening.booking_closes_at or screening.starts_at
    if local_now >= close_at:
        raise HTTPException(status_code=400, detail="Бронирование на этот показ закрыто")

    _expire_overdue(db)

    # Загружаем все нужные типы мест разом и проверяем что они от этой крыши
    sst_ids = [it.screening_seat_type_id for it in payload.items]
    ssts = (
        db.query(ScreeningSeatType)
        .filter(ScreeningSeatType.id.in_(sst_ids))
        .all()
    )
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

    full_name = (payload.full_name or user.full_name or "").strip()
    email = (payload.email or user.email).strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Укажите ФИО")
    if not email:
        raise HTTPException(status_code=400, detail="Укажите email")

    total = sum(float(sst_map[it.screening_seat_type_id].price) * it.qty for it in payload.items)
    expires_at = datetime.utcnow() + timedelta(minutes=screening.booking_window_minutes)

    booking = Booking(
        user_id=user.id,
        screening_id=screening.id,
        full_name=full_name,
        email=email,
        phone=payload.phone or user.phone,
        social_url=payload.social_url or user.social_url,
        status=BookingStatus.waiting_payment.value,
        expires_at=expires_at,
        total_amount=total,
        qr_token=secrets.token_urlsafe(32),
        short_code=_gen_short_code(db),
        note=payload.note,
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
    db.refresh(booking)
    _broadcast(screening.id, "created", booking.id)
    b = db.query(Booking).options(*_eager()).filter(Booking.id == booking.id).first()
    return _to_out(b)


_CANCELLABLE = (
    BookingStatus.waiting_payment.value,
    BookingStatus.paid.value,
    BookingStatus.paid_by_balance.value,
)


@router.post("/{booking_id}/cancel", response_model=BookingOut)
def cancel_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = db.query(Booking).options(*_eager()).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    is_owner = b.user_id == user.id
    is_admin = user.role in (UserRole.super_admin.value, UserRole.admin.value)
    if not (is_owner or is_admin):
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")
    # Если действует как администратор (не как владелец брони) — проверяем гранулярные права
    if not is_owner and is_admin and user.role != UserRole.super_admin.value:
        if user.permissions is not None and "manage_cancellations" not in user.permissions:
            raise HTTPException(status_code=403, detail="У вас нет права: manage_cancellations")
    if b.status not in _CANCELLABLE:
        raise HTTPException(status_code=400, detail=f"Нельзя отменить бронь в статусе {b.status}")
    was_paid = b.status in (BookingStatus.paid.value, BookingStatus.paid_by_balance.value)
    b.cancelled_at = datetime.utcnow()
    b.cancel_reason = "Отменено пользователем" if is_owner else "Отменено администратором"

    # Если бронь была оплачена — автоматически создаём запрос на возврат вместо
    # простой отмены. Ставим status=refund_pending; пользователь должен заполнить
    # реквизиты по ссылке из письма/баннера на странице брони.
    auto_rr: RefundRequest | None = None
    if was_paid:
        total = float(b.total_amount)
        balance_used = float(b.balance_used or 0)
        external_amount = max(0.0, total - balance_used)

        # Возвращаем на баланс ту часть, что была оплачена с баланса
        if balance_used > 0 and b.user_id:
            owner = db.get(User, b.user_id)
            if owner:
                owner.balance = float(owner.balance or 0) + balance_used

        if external_amount > 0:
            # Есть что вернуть переводом — создаём RefundRequest и ставим refund_pending
            existing_rr = db.query(RefundRequest).filter(RefundRequest.booking_id == b.id).first()
            if not existing_rr:
                auto_rr = RefundRequest(
                    booking_id=b.id,
                    status=RefundRequestStatus.created.value,
                    payout_token=secrets.token_urlsafe(24),
                    amount=external_amount,
                    # created_by_admin_id = None — создано автоматически при отмене
                )
                db.add(auto_rr)
            b.status = BookingStatus.refund_pending.value
        else:
            # Всё было с баланса — обычная отмена (баланс уже вернули выше)
            b.status = BookingStatus.cancelled.value
    else:
        b.status = BookingStatus.cancelled.value

    db.commit()
    _broadcast(b.screening_id, "updated", b.id)

    # Отправляем письмо с ссылкой на возврат (если создали RefundRequest)
    if auto_rr is not None:
        try:
            from .refunds import _send_refund_link_email
            sent = _send_refund_link_email(db, b, auto_rr)
            if sent:
                auto_rr.link_sent_at = datetime.utcnow()
                db.commit()
        except Exception:
            pass

    # Email-уведомление об отмене (по шаблону user_cancel_notice, если настроен)
    try:
        from ..email_service import send_email
        from ..models import MessageTemplate
        from ..utils import render_template
        tpl = (
            db.query(MessageTemplate)
            .filter(MessageTemplate.kind == "user_cancel_notice", MessageTemplate.is_default.is_(True))
            .first()
        )
        if tpl and b.email:
            ctx = {
                "full_name": b.full_name,
                "movie": b.screening.movie.title if b.screening and b.screening.movie else "",
                "starts_at": b.screening.starts_at.strftime("%d.%m.%Y %H:%M") if b.screening else "",
                "rooftop": b.screening.rooftop.name if b.screening and b.screening.rooftop else "",
                "reason": b.cancel_reason or "",
            }
            body = render_template(tpl.text, ctx)
            send_email(b.email, "Ваша бронь отменена — Кино на крыше", body)
    except Exception:
        pass

    return _to_out(db.query(Booking).options(*_eager()).filter(Booking.id == b.id).first())


# === АДМИН-ДЕЙСТВИЯ ===

@router.post("/{booking_id}/mark-paid", response_model=BookingOut, dependencies=[Depends(require_perm("manage_bookings"))])
def mark_paid_admin(booking_id: int, db: Session = Depends(get_db)):
    """Админ помечает бронь оплаченной (через перевод подтверждённый вручную).
    Фаза 5 добавит загрузку чека + подтверждение."""
    b = db.query(Booking).options(*_eager()).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.status != BookingStatus.waiting_payment.value:
        raise HTTPException(status_code=400, detail=f"Нельзя пометить оплаченной бронь в статусе {b.status}")
    b.status = BookingStatus.paid.value
    b.paid_at = datetime.utcnow()
    db.commit()
    _broadcast(b.screening_id, "updated", b.id)
    return _to_out(db.query(Booking).options(*_eager()).filter(Booking.id == b.id).first())


@router.post("/{booking_id}/extend", response_model=BookingOut, dependencies=[Depends(require_perm("manage_bookings"))])
def extend_booking(booking_id: int, minutes: int, db: Session = Depends(get_db)):
    """Продлить окно оплаты на N минут (только waiting_payment)."""
    if minutes < 1 or minutes > 24 * 60 * 7:
        raise HTTPException(status_code=400, detail="Допустимо от 1 минуты до 7 дней")
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.status != BookingStatus.waiting_payment.value:
        raise HTTPException(status_code=400, detail="Продлить можно только бронь, ожидающую оплаты")
    base = max(b.expires_at, datetime.utcnow())
    b.expires_at = base + timedelta(minutes=minutes)
    db.commit()
    _broadcast(b.screening_id, "updated", b.id)
    return _to_out(db.query(Booking).options(*_eager()).filter(Booking.id == b.id).first())


@router.post("/{booking_id}/transfer", response_model=BookingOut, dependencies=[Depends(require_perm("manage_transfers"))])
def transfer_booking(booking_id: int, target_screening_id: int, db: Session = Depends(get_db)):
    """Перенести бронь на другой показ. Требует, чтобы у цели были типы мест с теми же именами и хватало мест."""
    b = db.query(Booking).options(selectinload(Booking.items)).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.status not in (BookingStatus.waiting_payment.value, BookingStatus.paid.value, BookingStatus.paid_by_balance.value):
        raise HTTPException(status_code=400, detail="Нельзя перенести бронь в этом статусе")
    target = (
        db.query(Screening)
        .options(selectinload(Screening.seats))
        .filter(Screening.id == target_screening_id)
        .first()
    )
    if not target or not target.is_active:
        raise HTTPException(status_code=404, detail="Целевой показ не найден или скрыт")
    if target.starts_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Целевой показ уже прошёл")

    by_name: dict[str, ScreeningSeatType] = {sst.name: sst for sst in target.seats}
    # проверки совместимости + остатков
    new_alloc: list[tuple[BookingItem, ScreeningSeatType]] = []
    for it in b.items:
        sst = by_name.get(it.name)
        if not sst:
            raise HTTPException(status_code=400, detail=f"В целевом показе нет типа места «{it.name}»")
        used = _stock_used(db, sst.id)
        if used + it.qty > sst.count:
            raise HTTPException(status_code=409, detail=f"Недостаточно мест «{sst.name}» в целевом показе")
        new_alloc.append((it, sst))

    old_screening_id = b.screening_id
    b.screening_id = target.id
    # перепривязываем items на новые ScreeningSeatType (цены не меняем — оплачено по старой цене)
    for it, sst in new_alloc:
        it.screening_seat_type_id = sst.id
    # если waiting_payment — обновим срок и таймер
    if b.status == BookingStatus.waiting_payment.value:
        b.expires_at = datetime.utcnow() + timedelta(minutes=target.booking_window_minutes)
    b.note = (b.note or "") + f"\n[Перенесено с показа #{old_screening_id} на #{target.id}]"
    db.commit()
    _broadcast(old_screening_id, "updated", b.id)
    _broadcast(target.id, "updated", b.id)
    return _to_out(db.query(Booking).options(*_eager()).filter(Booking.id == b.id).first())


@router.post("/{booking_id}/refund-to-balance", response_model=BookingOut, dependencies=[Depends(require_perm("manage_cancellations"))])
def refund_to_balance(booking_id: int, db: Session = Depends(get_db)):
    """Возврат оплаченной (или ждущей оплаты) брони на баланс пользователя.
    Меняет статус на refunded и пополняет user.balance на total_amount."""
    b = db.query(Booking).options(*_eager()).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if not b.user_id:
        raise HTTPException(status_code=400, detail="У брони нет привязанного пользователя")
    # Допускаем возврат для cancelled и refund_pending (после отмены оплаченной брони).
    # Запрещаем только если уже refunded или истёк срок (там нечего возвращать).
    if b.status in (BookingStatus.refunded.value, BookingStatus.expired.value):
        raise HTTPException(status_code=400, detail=f"Бронь в статусе {b.status} — возврат не нужен")
    user = db.get(User, b.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Пользователь не найден")
    amount = float(b.total_amount)
    user.balance = float(user.balance or 0) + amount
    b.status = BookingStatus.refunded.value
    b.cancelled_at = datetime.utcnow()
    b.cancel_reason = "Возврат на баланс"
    db.commit()
    _broadcast(b.screening_id, "updated", b.id)
    return _to_out(db.query(Booking).options(*_eager()).filter(Booking.id == b.id).first())


@router.post("/{booking_id}/apply-balance", response_model=BookingOut)
def apply_balance(
    booking_id: int,
    amount: float,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Списать произвольную сумму с баланса пользователя на эту бронь.
    Если покрывает остаток полностью — статус становится paid_by_balance.
    Иначе бронь остаётся в waiting_payment, остаток нужно оплатить переводом."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть положительной")
    b = db.query(Booking).options(*_eager()).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.user_id != user.id:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")
    if b.status != BookingStatus.waiting_payment.value:
        raise HTTPException(status_code=400, detail="Оплатить можно только бронь, ожидающую оплаты")

    total = float(b.total_amount)
    already = float(b.balance_used or 0)
    remaining_due = max(0.0, total - already)
    if amount > remaining_due + 1e-9:
        raise HTTPException(status_code=400, detail=f"К доплате осталось {remaining_due:.0f} ₽")
    current = float(user.balance or 0)
    if amount > current + 1e-9:
        raise HTTPException(status_code=400, detail=f"На балансе только {current:.0f} ₽")

    user.balance = current - amount
    b.balance_used = already + amount
    if b.balance_used >= total - 1e-9:
        b.status = BookingStatus.paid_by_balance.value
        b.paid_at = datetime.utcnow()
    db.commit()
    _broadcast(b.screening_id, "updated", b.id)
    return _to_out(db.query(Booking).options(*_eager()).filter(Booking.id == b.id).first())


# Сохраняем старый эндпоинт для обратной совместимости — оплачивает полную сумму.
@router.post("/{booking_id}/pay-by-balance", response_model=BookingOut)
def pay_by_balance_full(
    booking_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = db.query(Booking).filter(Booking.id == booking_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    remaining = float(b.total_amount) - float(b.balance_used or 0)
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="К оплате 0 ₽")
    return apply_balance(booking_id, remaining, db, user)
