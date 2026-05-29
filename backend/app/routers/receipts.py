"""Чеки об оплате (перевод): пользователь загружает, админ подтверждает/отклоняет."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from ..db import get_db
from ..deps import get_current_user, require_admin_or_super, require_perm
from ..email_service import send_payment_rejected
from ..models import (
    Booking,
    BookingStatus,
    PaymentReceipt,
    PaymentReceiptStatus,
    Rooftop,
    RooftopAdmin,
    Screening,
    User,
    UserRole,
)
from ..schemas import (
    BookingOut,
    PaymentReceiptAdminOut,
    PaymentReceiptOut,
    PaymentReceiptRejectIn,
)
from ..ws_manager import manager

from .bookings import _to_out as booking_to_out, _eager as booking_eager

router = APIRouter(tags=["receipts"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "receipts"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXT = {"jpg", "jpeg", "png", "webp", "gif", "avif", "pdf"}
MAX_SIZE = 8 * 1024 * 1024  # 8 МБ


def _broadcast(screening_id: int, booking_id: int) -> None:
    manager.broadcast_threadsafe(
        f"screening:{screening_id}",
        {"event": "updated", "booking_id": booking_id, "screening_id": screening_id},
    )


def _admin_can_review(db: Session, user: User, booking: Booking) -> bool:
    """super_admin может всё; обычный admin — если у него can_approve_payments на крыше показа."""
    if user.role == UserRole.super_admin.value:
        return True
    if user.role != UserRole.admin.value:
        return False
    scr = db.get(Screening, booking.screening_id)
    if not scr:
        return False
    link = (
        db.query(RooftopAdmin)
        .filter(
            RooftopAdmin.user_id == user.id,
            RooftopAdmin.rooftop_id == scr.rooftop_id,
            RooftopAdmin.can_approve_payments.is_(True),
        )
        .first()
    )
    return link is not None


def _receipt_to_admin_out(r: PaymentReceipt) -> PaymentReceiptAdminOut:
    b = r.booking
    scr = b.screening if b else None
    return PaymentReceiptAdminOut(
        id=r.id,
        booking_id=r.booking_id,
        image_url=r.image_url,
        status=r.status,
        amount_claimed=float(r.amount_claimed) if r.amount_claimed is not None else None,
        rejection_reason=r.rejection_reason,
        uploaded_at=r.uploaded_at,
        reviewed_at=r.reviewed_at,
        booking_full_name=b.full_name if b else "",
        booking_email=b.email if b else "",
        booking_total_amount=float(b.total_amount) if b else 0.0,
        booking_balance_used=float(b.balance_used or 0) if b else 0.0,
        booking_status=b.status if b else "",
        booking_short_code=b.short_code if b else "",
        screening_id=b.screening_id if b else 0,
        screening_starts_at=scr.starts_at if scr else datetime.utcnow(),
        movie_title=(scr.movie.title if scr and scr.movie else ""),
        rooftop_name=(scr.rooftop.name if scr and scr.rooftop else ""),
    )


# === пользовательский endpoint ===

@router.post(
    "/api/bookings/{booking_id}/receipts",
    response_model=BookingOut,
    status_code=201,
)
async def upload_receipt(
    booking_id: int,
    file: UploadFile = File(...),
    amount_claimed: float | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Пользователь загружает чек об оплате. Только если бронь waiting_payment
    и нет уже висящего pending-чека."""
    b = (
        db.query(Booking)
        .options(*booking_eager(), selectinload(Booking.receipts))
        .filter(Booking.id == booking_id)
        .first()
    )
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    if b.user_id != user.id:
        raise HTTPException(status_code=403, detail="Нет доступа к этой брони")
    if b.status != BookingStatus.waiting_payment.value:
        raise HTTPException(status_code=400, detail=f"Нельзя загрузить чек: бронь в статусе {b.status}")

    pending = next((r for r in b.receipts if r.status == PaymentReceiptStatus.pending.value), None)
    if pending:
        raise HTTPException(status_code=409, detail="Уже есть чек на проверке — дождитесь решения")

    ct = (file.content_type or "").lower()
    ext = ""
    if "/" in ct:
        ext = ct.split("/", 1)[1].split(";", 1)[0]
    if ext == "jpeg":
        ext = "jpg"
    if ext not in ALLOWED_EXT and file.filename and "." in file.filename:
        ext = file.filename.rsplit(".", 1)[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Неподдерживаемый формат. Разрешены: {', '.join(sorted(ALLOWED_EXT))}")

    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=413, detail=f"Файл слишком большой (максимум {MAX_SIZE // 1024 // 1024} МБ)")
    if not data:
        raise HTTPException(status_code=400, detail="Файл пустой")

    name = f"{secrets.token_urlsafe(16)}.{ext}"
    path = UPLOAD_DIR / name
    path.write_bytes(data)
    image_url = f"/uploads/receipts/{name}"

    receipt = PaymentReceipt(
        booking_id=b.id,
        image_url=image_url,
        status=PaymentReceiptStatus.pending.value,
        amount_claimed=amount_claimed,
    )
    db.add(receipt)
    db.commit()

    _broadcast(b.screening_id, b.id)
    fresh = db.query(Booking).options(*booking_eager(), selectinload(Booking.receipts)).filter(Booking.id == b.id).first()
    return booking_to_out(fresh)


# === админ-эндпоинты ===

@router.get(
    "/api/admin/receipts/pending-count",
    dependencies=[Depends(require_perm("manage_receipts"))],
)
def pending_count(
    db: Session = Depends(get_db),
    user: User = Depends(require_perm("manage_receipts")),
):
    """Сколько чеков ждут проверки. Для бейджа в админ-навигации."""
    q = db.query(func.count(PaymentReceipt.id)).filter(
        PaymentReceipt.status == PaymentReceiptStatus.pending.value
    )
    if user.role == UserRole.admin.value:
        rooftop_ids = [
            r.rooftop_id for r in db.query(RooftopAdmin).filter(
                RooftopAdmin.user_id == user.id,
                RooftopAdmin.can_approve_payments.is_(True),
            ).all()
        ]
        if not rooftop_ids:
            return {"count": 0}
        q = q.join(Booking, PaymentReceipt.booking_id == Booking.id) \
             .join(Screening, Booking.screening_id == Screening.id) \
             .filter(Screening.rooftop_id.in_(rooftop_ids))
    return {"count": int(q.scalar() or 0)}


@router.get(
    "/api/admin/receipts",
    response_model=list[PaymentReceiptAdminOut],
    dependencies=[Depends(require_perm("manage_receipts"))],
)
def list_receipts_admin(
    status: str = "pending",
    db: Session = Depends(get_db),
    user: User = Depends(require_perm("manage_receipts")),
):
    q = (
        db.query(PaymentReceipt)
        .options(
            joinedload(PaymentReceipt.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.movie),
            joinedload(PaymentReceipt.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.rooftop)
            .joinedload(Rooftop.city),
        )
        .filter(PaymentReceipt.status == status)
    )
    if user.role == UserRole.admin.value:
        rooftop_ids = [
            r.rooftop_id for r in db.query(RooftopAdmin).filter(
                RooftopAdmin.user_id == user.id,
                RooftopAdmin.can_approve_payments.is_(True),
            ).all()
        ]
        if not rooftop_ids:
            return []
        q = q.join(Booking, PaymentReceipt.booking_id == Booking.id) \
             .join(Screening, Booking.screening_id == Screening.id) \
             .filter(Screening.rooftop_id.in_(rooftop_ids))
    receipts = q.order_by(PaymentReceipt.uploaded_at.asc()).limit(500).all()
    return [_receipt_to_admin_out(r) for r in receipts]


@router.post(
    "/api/admin/receipts/{receipt_id}/approve",
    response_model=PaymentReceiptAdminOut,
)
def approve_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_perm("manage_receipts")),
):
    r = (
        db.query(PaymentReceipt)
        .options(
            joinedload(PaymentReceipt.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.movie),
            joinedload(PaymentReceipt.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.rooftop),
        )
        .filter(PaymentReceipt.id == receipt_id)
        .first()
    )
    if not r:
        raise HTTPException(status_code=404, detail="Чек не найден")
    if r.status != PaymentReceiptStatus.pending.value:
        raise HTTPException(status_code=400, detail=f"Чек уже обработан ({r.status})")
    if not r.booking:
        raise HTTPException(status_code=400, detail="Бронь чека не найдена")
    if not _admin_can_review(db, user, r.booking):
        raise HTTPException(status_code=403, detail="Нет прав на чеки этой крыши")

    b = r.booking
    if b.status != BookingStatus.waiting_payment.value:
        raise HTTPException(status_code=400, detail=f"Бронь в статусе {b.status}, подтверждение не нужно")

    now = datetime.utcnow()
    r.status = PaymentReceiptStatus.approved.value
    r.reviewed_at = now
    r.reviewed_by_id = user.id
    b.status = BookingStatus.paid.value
    b.paid_at = now
    db.commit()

    _broadcast(b.screening_id, b.id)

    # Письмо «После оплаты» по шаблону post_payment (с QR, кодом, составом и т.д.)
    try:
        from ..booking_notify import send_post_payment_email
        send_post_payment_email(db, b)
    except Exception:
        pass

    db.refresh(r)
    return _receipt_to_admin_out(r)


@router.post(
    "/api/admin/receipts/{receipt_id}/reject",
    response_model=PaymentReceiptAdminOut,
)
def reject_receipt(
    receipt_id: int,
    payload: PaymentReceiptRejectIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_perm("manage_receipts")),
):
    r = (
        db.query(PaymentReceipt)
        .options(
            joinedload(PaymentReceipt.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.movie),
            joinedload(PaymentReceipt.booking)
            .joinedload(Booking.screening)
            .joinedload(Screening.rooftop),
        )
        .filter(PaymentReceipt.id == receipt_id)
        .first()
    )
    if not r:
        raise HTTPException(status_code=404, detail="Чек не найден")
    if r.status != PaymentReceiptStatus.pending.value:
        raise HTTPException(status_code=400, detail=f"Чек уже обработан ({r.status})")
    if not r.booking:
        raise HTTPException(status_code=400, detail="Бронь чека не найдена")
    if not _admin_can_review(db, user, r.booking):
        raise HTTPException(status_code=403, detail="Нет прав на чеки этой крыши")

    now = datetime.utcnow()
    b = r.booking
    # Если бронь ещё ждёт оплаты — продлеваем срок на длительность проверки чека
    # (время «на паузе»). Тем самым таймер у пользователя возобновится с того же
    # значения, на котором остановился при загрузке чека.
    if b.status == BookingStatus.waiting_payment.value and r.uploaded_at:
        paused_for = now - r.uploaded_at
        if paused_for.total_seconds() > 0:
            b.expires_at = b.expires_at + paused_for

        # Бонус +25% к окну, если после возобновления остаётся <25%.
        # Это даёт пользователю гарантированно достаточно времени, чтобы
        # переслать новый чек после отказа.
        try:
            window = timedelta(minutes=int(b.screening.booking_window_minutes or 120))
        except Exception:
            window = timedelta(minutes=120)
        remaining = b.expires_at - now
        if remaining > timedelta(0) and remaining * 4 < window:
            bonus = window // 4  # 25% от окна
            b.expires_at = b.expires_at + bonus

    r.status = PaymentReceiptStatus.rejected.value
    r.reviewed_at = now
    r.reviewed_by_id = user.id
    r.rejection_reason = payload.reason.strip()
    db.commit()

    _broadcast(b.screening_id, b.id)

    movie_title = b.screening.movie.title if b.screening and b.screening.movie else ""
    try:
        send_payment_rejected(b.email, movie_title, b.id, r.rejection_reason)
    except Exception:
        pass

    db.refresh(r)
    return _receipt_to_admin_out(r)
