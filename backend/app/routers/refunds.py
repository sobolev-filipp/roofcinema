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
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session, joinedload

from ..balance import debit_balance, get_balance, norm_email
from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user, require_admin_or_super, require_perm
from ..email_service import send_email, send_email_with_attachment
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

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
_RECEIPT_EXT = {"pdf", "jpg", "jpeg", "png", "webp"}
_RECEIPT_MAX = 10 * 1024 * 1024  # 10 МБ


def _refund_completed_context(rr: RefundRequest) -> dict:
    """Плейсхолдеры для шаблона refund_completed: ФИО, город, показ, места, сумма."""
    b = rr.booking
    s = b.screening if b else None
    if b:
        items_text = "\n".join(
            f"- {it.name} ×{it.qty} — {int(float(it.price_each) * it.qty)} ₽" for it in b.items
        )
        full_name = b.full_name
        city = s.rooftop.city.name if (s and s.rooftop and s.rooftop.city) else ""
        movie = s.movie.title if (s and s.movie) else ""
    else:
        items_text = ""
        full_name = rr.payout_full_name or ""
        city = ""
        movie = "Возврат с баланса"
    return {
        "full_name": full_name,
        "city": city,
        "movie": movie,
        "items": items_text,
        "amount": f"{int(float(rr.amount))}",
    }


def _send_refund_completed_email(db: Session, rr: RefundRequest) -> None:
    """Письмо о выполненном возврате по шаблону refund_completed.
    Если у запроса прикреплён чек — отправляем письмо с вложением."""
    to_email = (rr.booking.email if rr.booking else rr.email) or ""
    if not to_email:
        return
    tpl = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.kind == "refund_completed", MessageTemplate.is_default.is_(True))
        .first()
        or db.query(MessageTemplate).filter(MessageTemplate.kind == "refund_completed").first()
    )
    ctx = _refund_completed_context(rr)
    if tpl:
        body = render_template(tpl.text, ctx)
    else:
        body = (
            f"Здравствуйте, {ctx['full_name']}!\n\n"
            f"Возврат средств на сумму {ctx['amount']} ₽ выполнен.\n"
            + (f"Показ: {ctx['movie']}\n" if ctx['movie'] else "")
            + "\nСпасибо, что были с нами!"
        )
    subject = "Возврат средств выполнен — Кино на крыше"

    # Прикрепляем чек, если админ его загрузил и файл на месте.
    attach_path: Path | None = None
    if rr.receipt_file_url:
        rel = rr.receipt_file_url.lstrip("/")
        if rel.startswith("uploads/"):
            rel = rel[len("uploads/"):]
        p = UPLOAD_DIR / rel
        if p.exists():
            attach_path = p

    if attach_path is not None:
        ext = attach_path.suffix.lstrip(".") or "pdf"
        send_email_with_attachment(
            to=to_email,
            subject=subject,
            body_text=body,
            body_html=None,
            attachment_path=attach_path,
            attachment_name=f"refund_{rr.id}.{ext}",
        )
    else:
        send_email(to_email, subject, body)


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
    if b:
        out.booking_full_name = b.full_name
        out.booking_email = b.email
        out.movie_title = (s.movie.title if s and s.movie else "") if s else ""
        out.screening_starts_at = s.starts_at if s else None
        out.rooftop_name = (s.rooftop.name if s and s.rooftop else "") if s else ""
    else:
        # возврат с баланса — брони нет
        out.booking_full_name = rr.payout_full_name or "—"
        out.booking_email = rr.email or ""
        out.movie_title = "Возврат с баланса"
        out.screening_starts_at = None
        out.rooftop_name = ""
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
    admin: User = Depends(require_perm("manage_refunds")),
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
    # Возврат средств уместен для: уже отменённой брони, брони в статусе «ожидает
    # возврата», ИЛИ брони с отменённого показа (needs_cancel_resolution=True —
    # статус всё ещё paid/paid_by_balance, но показ отменён и ждёт решения).
    allowed = (
        b.status in (BookingStatus.cancelled.value, BookingStatus.refund_pending.value)
        or b.needs_cancel_resolution
    )
    if not allowed:
        raise HTTPException(
            status_code=400,
            detail="Возврат средств создаётся для отменённой брони, брони с отменённого показа или брони, ожидающей возврата",
        )

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
    b.needs_cancel_resolution = False  # вопрос по отменённому показу закрыт
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
    _admin: User = Depends(require_perm("manage_refunds")),
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
    if rr.booking is None:
        raise HTTPException(
            status_code=400,
            detail="Это возврат с баланса — реквизиты уже заполнены пользователем, ссылку отправлять не нужно",
        )
    sent = _send_refund_link_email(db, rr.booking, rr)
    if not sent:
        raise HTTPException(status_code=502, detail="Не удалось отправить email — проверьте SMTP")
    rr.link_sent_at = datetime.utcnow()
    db.commit()
    db.refresh(rr)
    return _to_admin_out(rr)


@router.get(
    "/api/admin/refund-requests/pending-count",
    dependencies=[Depends(require_perm("manage_refunds"))],
)
def pending_refunds_count(db: Session = Depends(get_db)):
    """Количество незавершённых запросов возврата (created + filled)."""
    count = (
        db.query(RefundRequest)
        .filter(RefundRequest.status.in_([
            RefundRequestStatus.created.value,
            RefundRequestStatus.filled.value,
        ]))
        .count()
    )
    return {"count": count}


@router.get(
    "/api/admin/refund-requests",
    response_model=list[RefundRequestOut],
    dependencies=[Depends(require_perm("manage_refunds"))],
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
    "/api/admin/refund-requests/{rr_id}/fill",
    response_model=RefundRequestOut,
)
def admin_fill_refund(
    rr_id: int,
    payload: RefundSubmitIn,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_perm("manage_refunds")),
):
    """Администратор вводит реквизиты вручную вместо пользователя."""
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
        raise HTTPException(status_code=400, detail="Возврат уже выполнен")

    rr.payout_full_name = payload.payout_full_name.strip()
    rr.payout_card_or_sbp = payload.payout_card_or_sbp.strip()
    rr.payout_bank = (payload.payout_bank or "").strip() or None
    rr.payout_comment = (payload.payout_comment or "").strip() or None
    rr.status = RefundRequestStatus.filled.value
    rr.filled_at = datetime.utcnow()
    db.commit()
    db.refresh(rr)
    return _to_admin_out(rr)


@router.post(
    "/api/admin/refund-requests/{rr_id}/mark-completed",
    response_model=RefundRequestOut,
)
async def mark_completed(
    rr_id: int,
    file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_perm("manage_refunds")),
):
    """Отмечает возврат выполненным. Необязательно можно прикрепить чек о переводе
    (PDF/изображение) — он уйдёт во вложении в письме пользователю.
    После отметки пользователю шлётся уведомление по шаблону refund_completed."""
    rr = (
        db.query(RefundRequest)
        .options(
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(RefundRequest.booking).joinedload(Booking.screening).joinedload(Screening.rooftop).joinedload(Rooftop.city),
            joinedload(RefundRequest.booking).joinedload(Booking.items),
        )
        .filter(RefundRequest.id == rr_id)
        .first()
    )
    if not rr:
        raise HTTPException(status_code=404, detail="Запрос не найден")
    if rr.status == RefundRequestStatus.completed.value:
        raise HTTPException(status_code=400, detail="Уже выполнен")

    # Необязательный чек о переводе
    if file is not None and file.filename:
        ext = file.filename.rsplit(".", 1)[1].lower() if "." in file.filename else ""
        if ext == "jpeg":
            ext = "jpg"
        if ext not in _RECEIPT_EXT:
            raise HTTPException(status_code=400, detail=f"Поддерживаются: {', '.join(sorted(_RECEIPT_EXT))}")
        data = await file.read()
        if len(data) > _RECEIPT_MAX:
            raise HTTPException(status_code=413, detail="Файл слишком большой (макс 10 МБ)")
        if len(data) == 0:
            raise HTTPException(status_code=400, detail="Файл пустой")
        name = f"refund_{rr.id}_{secrets.token_urlsafe(8)}.{ext}"
        (UPLOAD_DIR / name).write_bytes(data)
        rr.receipt_file_url = f"/uploads/{name}"

    rr.status = RefundRequestStatus.completed.value
    rr.completed_at = datetime.utcnow()
    rr.completed_by_admin_id = admin.id
    if rr.booking:
        rr.booking.status = BookingStatus.refunded.value
    db.commit()
    db.refresh(rr)

    try:
        _send_refund_completed_email(db, rr)
    except Exception:
        pass
    return _to_admin_out(rr)


# === АДМИН: возврат средств с баланса клиента (раздел «Клиенты») ===

class AdminBalanceRefundIn(BaseModel):
    email: EmailStr
    amount: float = Field(gt=0, description="Сколько вернуть с баланса")
    payout_full_name: str | None = Field(default=None, max_length=255)
    payout_card_or_sbp: str | None = Field(default=None, max_length=64)
    payout_bank: str | None = Field(default=None, max_length=120)
    payout_comment: str | None = None


@router.post(
    "/api/admin/balance-refund-request",
    response_model=RefundRequestOut,
    status_code=201,
)
def admin_create_balance_refund(
    payload: AdminBalanceRefundIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_perm("manage_refunds")),
):
    """Создаёт запрос на возврат с баланса клиента на произвольную сумму.
    Сумма сразу списывается с баланса (по email), чтобы её нельзя было потратить дважды.
    Реквизиты можно указать сразу (→ статус «filled») или позже в разделе «Возвраты»."""
    email = norm_email(payload.email)
    if not email:
        raise HTTPException(status_code=400, detail="Не указан email клиента")
    balance = get_balance(db, email)
    if payload.amount > balance + 1e-9:
        raise HTTPException(
            status_code=400,
            detail=f"На балансе только {balance:.0f} ₽ — нельзя вернуть {payload.amount:.0f} ₽",
        )

    full_name = (payload.payout_full_name or "").strip()
    card = (payload.payout_card_or_sbp or "").strip()
    has_requisites = bool(full_name and len(card) >= 4)

    rr = RefundRequest(
        booking_id=None,
        email=email,
        amount=payload.amount,
        status=RefundRequestStatus.filled.value if has_requisites else RefundRequestStatus.created.value,
        payout_token=secrets.token_urlsafe(24),
        payout_full_name=full_name or None,
        payout_card_or_sbp=card or None,
        payout_bank=(payload.payout_bank or "").strip() or None,
        payout_comment=(payload.payout_comment or "").strip() or None,
        created_by_admin_id=admin.id,
        filled_at=datetime.utcnow() if has_requisites else None,
    )
    db.add(rr)
    debit_balance(db, email, payload.amount)
    db.commit()
    db.refresh(rr)
    return _to_admin_out(rr)


# === ПОЛЬЗОВАТЕЛЬ: возврат средств со своего баланса ===

@router.post("/api/me/balance-refund-request", status_code=201)
def request_balance_refund(
    payload: RefundSubmitIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Пользователь запрашивает возврат всех средств со своего баланса (по email).
    Создаётся RefundRequest без брони, статус сразу `filled` (реквизиты уже введены).
    Баланс списывается немедленно — чтобы те же деньги нельзя было потратить дважды."""
    email = norm_email(user.email)
    balance = get_balance(db, email)
    if balance <= 0:
        raise HTTPException(status_code=400, detail="На балансе нет средств для возврата")

    existing = (
        db.query(RefundRequest)
        .filter(
            RefundRequest.booking_id.is_(None),
            RefundRequest.email == email,
            RefundRequest.status != RefundRequestStatus.completed.value,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Запрос на возврат с баланса уже создан и ожидает обработки",
        )

    rr = RefundRequest(
        booking_id=None,
        email=email,
        amount=balance,
        status=RefundRequestStatus.filled.value,
        payout_token=secrets.token_urlsafe(24),
        payout_full_name=payload.payout_full_name.strip(),
        payout_card_or_sbp=payload.payout_card_or_sbp.strip(),
        payout_bank=(payload.payout_bank or "").strip() or None,
        payout_comment=(payload.payout_comment or "").strip() or None,
        filled_at=datetime.utcnow(),
    )
    db.add(rr)
    debit_balance(db, email, balance)
    db.commit()
    return {"ok": True, "amount": float(balance), "balance": get_balance(db, email)}


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
