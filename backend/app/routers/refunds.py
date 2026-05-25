"""Возврат средств по отменённым бронированиям (Этап E).

Поток:
  1. У брони status=cancelled и она была оплачена.
  2. Админ создаёт RefundRequest → пользователю уходит письмо со ссылкой /refund/{token}.
  3. Пользователь открывает ссылку, заполняет реквизиты → status=filled.
  4. Админ переводит деньги вручную и в админке нажимает «Перевод выполнен» → status=completed.
"""
from __future__ import annotations

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..config import get_settings
from ..db import get_db
from ..deps import require_admin_or_super
from ..email_service import send_email
from ..models import (
    Booking,
    BookingStatus,
    MessageTemplate,
    RefundRequest,
    RefundRequestStatus,
    Rooftop,
    Screening,
    User,
)
from ..schemas import (
    RefundClaimOut,
    RefundRequestOut,
    RefundSubmitIn,
)
from ..utils import render_template

router = APIRouter(tags=["refunds"])


def _absolute_refund_url(token: str) -> str:
    s = get_settings()
    return f"{s.APP_BASE_URL.rstrip('/')}/refund/{token}"


def _send_refund_link_email(db: Session, b: Booking, rr: RefundRequest) -> bool:
    """Шлёт пользователю письмо со ссылкой на форму. True если отправили."""
    tpl = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.kind == "refund_link", MessageTemplate.is_default.is_(True))
        .first()
    )
    link = _absolute_refund_url(rr.payout_token)
    if tpl:
        ctx = {
            "full_name": b.full_name,
            "movie": b.screening.movie.title if b.screening and b.screening.movie else "",
            "amount": f"{float(rr.amount):.0f}",
            "refund_link": link,
        }
        body = render_template(tpl.text, ctx)
    else:
        body = (
            f"Здравствуйте, {b.full_name}!\n\n"
            f"Для возврата {float(rr.amount):.0f} ₽ заполните реквизиты по ссылке:\n"
            f"{link}\n\n"
            f"Это безопасная форма — данные увидит только организатор для перевода."
        )
    if not b.email:
        return False
    return send_email(b.email, "Возврат средств — Кино на крыше", body)


def _to_admin_out(rr: RefundRequest) -> RefundRequestOut:
    b = rr.booking
    s = b.screening if b else None
    out = RefundRequestOut.model_validate(rr, from_attributes=True)
    out.payout_url = _absolute_refund_url(rr.payout_token)
    out.booking_full_name = b.full_name if b else ""
    out.booking_email = b.email if b else ""
    out.movie_title = (s.movie.title if s and s.movie else "") if s else ""
    out.screening_starts_at = s.starts_at if s else None
    out.rooftop_name = (s.rooftop.name if s and s.rooftop else "") if s else ""
    return out


# === АДМИН: создать запрос на возврат ===

@router.post(
    "/api/admin/bookings/{booking_id}/refund-request",
    response_model=RefundRequestOut,
    status_code=201,
)
def create_refund_request(
    booking_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_or_super),
):
    b = (
        db.query(Booking)
        .options(
            joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(Booking.screening).joinedload(Screening.rooftop),
        )
        .filter(Booking.id == booking_id)
        .first()
    )
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.status != BookingStatus.cancelled.value:
        raise HTTPException(status_code=400, detail="Запрос на возврат создаётся только для отменённой брони")

    existing = db.query(RefundRequest).filter(RefundRequest.booking_id == b.id).first()
    if existing:
        # уже создан — просто возвращаем (можно потом переотправить ссылку через /send-link)
        return _to_admin_out(existing)

    # сумма к возврату: оплаченная (total) минус то что было с баланса (его вернём отдельно)
    # Здесь предполагаем что админ создаёт refund только за «реальную» оплату.
    refund_amount = max(0.0, float(b.total_amount) - float(b.balance_used or 0))
    if refund_amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="К возврату 0 ₽ — вся сумма брони покрыта балансом. Используйте «Вернуть на баланс».",
        )

    rr = RefundRequest(
        booking_id=b.id,
        status=RefundRequestStatus.created.value,
        payout_token=secrets.token_urlsafe(24),
        amount=refund_amount,
        created_by_admin_id=admin.id,
    )
    db.add(rr)
    db.flush()

    # отправляем письмо со ссылкой
    sent = False
    try:
        sent = _send_refund_link_email(db, b, rr)
    except Exception:
        sent = False
    if sent:
        rr.link_sent_at = datetime.utcnow()
    # переводим бронь в refund_pending
    b.status = BookingStatus.refund_pending.value
    db.commit()
    db.refresh(rr)
    return _to_admin_out(rr)


@router.post(
    "/api/admin/refund-requests/{rr_id}/send-link",
    response_model=RefundRequestOut,
)
def resend_link(
    rr_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin_or_super),
):
    rr = (
        db.query(RefundRequest)
        .options(
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.rooftop),
        )
        .filter(RefundRequest.id == rr_id)
        .first()
    )
    if not rr:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    if rr.status == RefundRequestStatus.completed.value:
        raise HTTPException(status_code=400, detail="Запрос уже выполнен — повторно слать не нужно")
    sent = _send_refund_link_email(db, rr.booking, rr)
    if not sent:
        raise HTTPException(status_code=502, detail="Не удалось отправить email — проверьте SMTP")
    rr.link_sent_at = datetime.utcnow()
    db.commit()
    db.refresh(rr)
    return _to_admin_out(rr)


@router.get(
    "/api/admin/refund-requests",
    response_model=list[RefundRequestOut],
    dependencies=[Depends(require_admin_or_super)],
)
def list_refunds(status: str | None = None, db: Session = Depends(get_db)):
    q = db.query(RefundRequest).options(
        joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.movie),
        joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.rooftop),
    )
    if status:
        q = q.filter(RefundRequest.status == status)
    rows = q.order_by(RefundRequest.created_at.desc()).limit(500).all()
    return [_to_admin_out(r) for r in rows]


@router.post(
    "/api/admin/refund-requests/{rr_id}/mark-completed",
    response_model=RefundRequestOut,
)
def mark_completed(
    rr_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_or_super),
):
    rr = (
        db.query(RefundRequest)
        .options(
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.rooftop),
        )
        .filter(RefundRequest.id == rr_id)
        .first()
    )
    if not rr:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    if rr.status == RefundRequestStatus.completed.value:
        raise HTTPException(status_code=400, detail="Уже выполнен")
    rr.status = RefundRequestStatus.completed.value
    rr.completed_at = datetime.utcnow()
    rr.completed_by_admin_id = admin.id
    if rr.booking:
        rr.booking.status = BookingStatus.refunded.value
    db.commit()
    db.refresh(rr)
    return _to_admin_out(rr)


# === ПУБЛИЧНЫЕ: пользователь заполняет реквизиты ===

@router.get("/api/refund/{token}", response_model=RefundClaimOut)
def get_refund_public(token: str, db: Session = Depends(get_db)):
    rr = (
        db.query(RefundRequest)
        .options(
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.rooftop)
            .joinedload(Rooftop.city),
        )
        .filter(RefundRequest.payout_token == token)
        .first()
    )
    if not rr:
        raise HTTPException(status_code=404, detail="Ссылка недействительна")
    b = rr.booking
    s = b.screening if b else None
    return RefundClaimOut(
        status=rr.status,
        amount=float(rr.amount),
        movie_title=(s.movie.title if s and s.movie else "") if s else "",
        screening_starts_at=s.starts_at if s else datetime.utcnow(),
        rooftop_name=(s.rooftop.name if s and s.rooftop else "") if s else "",
        main_booker_name=b.full_name if b else "",
        payout_full_name=rr.payout_full_name,
        payout_card_or_sbp=rr.payout_card_or_sbp,
        payout_bank=rr.payout_bank,
        payout_comment=rr.payout_comment,
        completed_at=rr.completed_at,
    )


@router.post("/api/refund/{token}/submit", response_model=RefundClaimOut)
def submit_refund_public(token: str, payload: RefundSubmitIn, db: Session = Depends(get_db)):
    rr = (
        db.query(RefundRequest)
        .options(
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.rooftop),
        )
        .filter(RefundRequest.payout_token == token)
        .first()
    )
    if not rr:
        raise HTTPException(status_code=404, detail="Ссылка недействительна")
    if rr.status == RefundRequestStatus.completed.value:
        raise HTTPException(status_code=400, detail="Возврат уже выполнен")

    rr.payout_full_name = payload.payout_full_name.strip()
    rr.payout_card_or_sbp = payload.payout_card_or_sbp.strip()
    rr.payout_bank = (payload.payout_bank or "").strip() or None
    rr.payout_comment = (payload.payout_comment or "").strip() or None
    rr.status = RefundRequestStatus.filled.value
    rr.filled_at = datetime.utcnow()
    db.commit()
    db.refresh(rr)
    return get_refund_public(token, db)
