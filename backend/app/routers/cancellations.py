"""Отмена показа целиком + раздел «Отмена показа» (разрешение по каждой броне).

Поток:
1. Админ жмёт «Отменить показ» → POST /api/admin/screenings/{id}/cancel (с причиной).
   - Показ помечается cancelled_at, is_active=False.
   - Всем активным броням шлётся письмо по шаблону admin_cancel_screening.
   - Оплаченные брони (paid/paid_by_balance/attended) получают флаг
     needs_cancel_resolution=True и попадают в раздел «Отмена показа».
   - Неоплаченные (waiting_payment) просто отменяются — возвращать нечего.
2. В разделе «Отмена показа» по каждой броне админ выбирает действие:
   перенос на другой показ / возврат на баланс / возврат денег (→ «Возвраты»).
   Эти действия используют существующие эндпоинты, которые снимают флаг.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload, selectinload

from ..booking_notify import build_booking_context
from ..db import get_db
from ..deps import require_perm
from ..email_service import send_email
from ..models import Booking, BookingStatus, MessageTemplate, Rooftop, Screening, User
from ..utils import render_template
from ..ws_manager import manager

router = APIRouter(prefix="/api/admin", tags=["admin-cancellations"])

_PAID = {
    BookingStatus.paid.value,
    BookingStatus.paid_by_balance.value,
    BookingStatus.attended.value,
}
_ACTIVE = _PAID | {BookingStatus.waiting_payment.value}


class CancelScreeningIn(BaseModel):
    reason: str = Field(default="", max_length=500)
    template_id: int | None = None  # какой шаблon admin_cancel_screening отправить


def _booking_row(b: Booking) -> dict:
    s = b.screening
    items = [{"name": it.name, "qty": it.qty, "price_each": float(it.price_each)} for it in b.items]
    return {
        "id": b.id,
        "full_name": b.full_name,
        "email": b.email,
        "phone": b.phone,
        "short_code": b.short_code,
        "status": b.status,
        "total_amount": float(b.total_amount),
        "balance_used": float(b.balance_used or 0),
        "items": items,
        "screening": {
            "id": s.id if s else None,
            "starts_at": s.starts_at.isoformat() if s else None,
            "movie_title": s.movie.title if (s and s.movie) else None,
            "rooftop_name": s.rooftop.name if (s and s.rooftop) else None,
            "city_name": (s.rooftop.city.name if (s and s.rooftop and s.rooftop.city) else None),
        } if s else None,
    }


@router.post("/screenings/{screening_id}/cancel")
def cancel_screening(
    screening_id: int,
    payload: CancelScreeningIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_perm("manage_cancellations")),
):
    """Отменяет показ целиком: помечает cancelled_at, шлёт письма, флагует
    оплаченные брони на разрешение, неоплаченные — отменяет."""
    s = (
        db.query(Screening)
        .options(joinedload(Screening.movie), joinedload(Screening.rooftop).joinedload(Rooftop.city))
        .filter(Screening.id == screening_id)
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Показ не найден")
    if s.cancelled_at:
        raise HTTPException(status_code=400, detail="Показ уже отменён")

    reason = (payload.reason or "").strip()
    now = datetime.utcnow()
    s.cancelled_at = now
    s.is_active = False

    # Выбираем шаблон письма: указанный template_id (с проверкой kind),
    # иначе дефолтный admin_cancel_screening. Текст берём один раз.
    tpl_text: str | None = None
    if payload.template_id is not None:
        tpl = db.query(MessageTemplate).filter(MessageTemplate.id == payload.template_id).first()
        if not tpl or tpl.kind != "admin_cancel_screening":
            raise HTTPException(status_code=400, detail="Выбран некорректный шаблон отмены показа")
        tpl_text = tpl.text
    else:
        tpl = (
            db.query(MessageTemplate)
            .filter(MessageTemplate.kind == "admin_cancel_screening", MessageTemplate.is_default.is_(True))
            .first()
            or db.query(MessageTemplate).filter(MessageTemplate.kind == "admin_cancel_screening").first()
        )
        tpl_text = tpl.text if tpl else None

    bookings = (
        db.query(Booking)
        .options(
            joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(Booking.screening).joinedload(Screening.rooftop).joinedload(Rooftop.city),
            selectinload(Booking.items),
        )
        .filter(Booking.screening_id == s.id, Booking.status.in_(_ACTIVE))
        .all()
    )

    flagged = 0
    for b in bookings:
        # письмо об отмене показа по выбранному шаблону (или fallback)
        try:
            if tpl_text:
                body = render_template(tpl_text, build_booking_context(b, {"reason": reason}))
            else:
                movie = s.movie.title if s.movie else ""
                body = (
                    f"Здравствуйте, {b.full_name}!\n\n"
                    f"К сожалению, показ «{movie}» "
                    f"({s.starts_at.strftime('%d.%m.%Y %H:%M')}) отменён."
                    + (f"\nПричина: {reason}" if reason else "")
                    + "\n\nМы свяжемся с вами по поводу переноса или возврата средств."
                )
            send_email(b.email, "Показ отменён — Кино на крыше", body)
        except Exception:
            pass

        if b.status in _PAID:
            b.needs_cancel_resolution = True
            flagged += 1
        else:
            # неоплаченная — просто аннулируем, возвращать нечего
            b.status = BookingStatus.cancelled.value
            b.cancelled_at = now
            b.cancel_reason = "Показ отменён"

    db.commit()
    # WS: обновляем комнату показа
    try:
        manager.broadcast_threadsafe(
            f"screening:{s.id}",
            {"event": "screening_cancelled", "screening_id": s.id},
        )
    except Exception:
        pass

    return {"ok": True, "emails_sent": len(bookings), "to_resolve": flagged}


@router.get("/cancellations", dependencies=[Depends(require_perm("manage_cancellations"))])
def list_cancellations(db: Session = Depends(get_db)):
    """Брони с отменённых показов, ожидающие решения админа."""
    bookings = (
        db.query(Booking)
        .options(
            joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(Booking.screening).joinedload(Screening.rooftop).joinedload(Rooftop.city),
            selectinload(Booking.items),
        )
        .filter(Booking.needs_cancel_resolution.is_(True))
        .order_by(Booking.id.desc())
        .all()
    )
    return [_booking_row(b) for b in bookings]


@router.get("/cancellations/pending-count", dependencies=[Depends(require_perm("manage_cancellations"))])
def cancellations_pending_count(db: Session = Depends(get_db)):
    n = db.query(Booking).filter(Booking.needs_cancel_resolution.is_(True)).count()
    return {"count": n}
