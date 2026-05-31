"""Эндпоинты для пост-чеков (чеков, которые админ отправляет пользователю
на email после показа).

Поток:
1. Пользователь/админ ставит галку needs_post_show_receipt=True при бронировании
   (или меняет позже через PATCH /api/bookings/{id}/post-show-receipt-preference).
2. Админ в разделе «Чеки → Чеки для отправки» видит список оплаченных броней,
   у которых стоит этот флаг и ещё нет отправленного чека.
3. Админ загружает файл чека (PDF/JPG/PNG) и шлёт письмо с вложением.
   Содержимое письма берётся из шаблона post_show_receipt.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload, selectinload

from ..db import get_db
from ..deps import require_perm
from ..config import get_settings
from ..email_service import send_email_with_attachment
from ..models import (
    Booking,
    BookingItem,
    MessageTemplate,
    PostShowReceipt,
    Rooftop,
    Screening,
    User,
)
from ..utils import now_in_tz, render_template

router = APIRouter(
    prefix="/api/admin/post-show-receipts",
    tags=["admin-post-show-receipts"],
)

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXT = {"pdf", "jpg", "jpeg", "png", "webp"}
MAX_SIZE = 10 * 1024 * 1024  # 10 МБ — чеки могут быть PDF


# no_show — гость не пришёл, но оплата была, чек после показа всё равно отправляем
_PAID_STATUSES = {"paid", "paid_by_balance", "attended", "no_show"}


def _booking_dict(b: Booking) -> dict:
    """Лёгкая сериализация для списков (не нужно тащить всю BookingOut со схемой)."""
    info = b.screening
    items_out = [
        {
            "name": it.name,
            "qty": it.qty,
            "price_each": float(it.price_each),
        }
        for it in b.items
    ]
    # Вычисляем расчётное окончание показа — фронту нужно знать «во сколько уйдёт чек»
    ends_at_iso = None
    if info:
        end_dt = info.ends_at
        if end_dt is None and info.movie and info.movie.duration_min:
            end_dt = info.starts_at + timedelta(minutes=int(info.movie.duration_min))
        if end_dt is None:
            end_dt = info.starts_at + timedelta(hours=3)
        ends_at_iso = end_dt.isoformat()
    return {
        "id": b.id,
        "full_name": b.full_name,
        "email": b.email,
        "short_code": b.short_code,
        "total_amount": float(b.total_amount),
        "needs_post_show_receipt": b.needs_post_show_receipt,
        "status": b.status,
        "items": items_out,
        "screening": {
            "id": info.id if info else None,
            "starts_at": info.starts_at.isoformat() if info else None,
            "ends_at": ends_at_iso,
            "movie_title": info.movie.title if (info and info.movie) else None,
            "movie_duration_min": (info.movie.duration_min if (info and info.movie) else None),
            "rooftop_name": info.rooftop.name if (info and info.rooftop) else None,
            "city_name": (
                info.rooftop.city.name
                if (info and info.rooftop and info.rooftop.city)
                else None
            ),
            "city_timezone": (
                info.rooftop.city.timezone
                if (info and info.rooftop and info.rooftop.city)
                else "Europe/Moscow"
            ),
        } if info else None,
        "post_show_receipt": (
            {
                "id": b.post_show_receipt.id,
                "file_url": b.post_show_receipt.file_url,
                "sent_at": (
                    b.post_show_receipt.sent_at.isoformat()
                    if b.post_show_receipt.sent_at else None
                ),
                "created_at": b.post_show_receipt.created_at.isoformat(),
            }
            if b.post_show_receipt else None
        ),
    }


def _bookings_query(db: Session):
    """Базовый запрос с предзагрузкой связей, нужных для списков пост-чеков."""
    return (
        db.query(Booking)
        .options(
            joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(Booking.screening).joinedload(Screening.rooftop).joinedload(Rooftop.city),
            selectinload(Booking.items),
            joinedload(Booking.post_show_receipt),
        )
        .filter(Booking.status.in_(_PAID_STATUSES))
        .filter(Booking.needs_post_show_receipt.is_(True))
    )


@router.get("/to-send", dependencies=[Depends(require_perm("manage_receipts"))])
def list_to_send(db: Session = Depends(get_db)):
    """Брони, ждущие отправки чека: статус paid/attended + флаг True + ещё не отправлен."""
    bookings = (
        _bookings_query(db)
        .order_by(Booking.created_at.desc())
        .all()
    )
    # Фильтруем те, где либо PostShowReceipt нет, либо он есть но sent_at пуст
    filtered = [
        b for b in bookings
        if b.post_show_receipt is None or b.post_show_receipt.sent_at is None
    ]
    return [_booking_dict(b) for b in filtered]


@router.get("/sent", dependencies=[Depends(require_perm("manage_receipts"))])
def list_sent(db: Session = Depends(get_db)):
    """Брони с уже отправленным пост-чеком."""
    bookings = (
        db.query(Booking)
        .options(
            joinedload(Booking.screening).joinedload(Screening.movie),
            joinedload(Booking.screening).joinedload(Screening.rooftop).joinedload(Rooftop.city),
            selectinload(Booking.items),
            joinedload(Booking.post_show_receipt),
        )
        .join(PostShowReceipt, PostShowReceipt.booking_id == Booking.id)
        .filter(PostShowReceipt.sent_at.is_not(None))
        .order_by(PostShowReceipt.sent_at.desc())
        .all()
    )
    return [_booking_dict(b) for b in bookings]


@router.get("/pending-count", dependencies=[Depends(require_perm("manage_receipts"))])
def pending_count(db: Session = Depends(get_db)):
    """Сколько броней ждут отправки чека — для бейджа в админке."""
    bookings = _bookings_query(db).all()
    n = sum(
        1 for b in bookings
        if b.post_show_receipt is None or b.post_show_receipt.sent_at is None
    )
    return {"count": n}


def _render_post_show_receipt_text(db: Session, b: Booking) -> str:
    """Берёт дефолтный шаблон post_show_receipt и подставляет данные брони.
    Если шаблона нет — возвращает дефолтный fallback-текст."""
    tpl = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.kind == "post_show_receipt", MessageTemplate.is_default.is_(True))
        .first()
    )
    if not tpl:
        tpl = (
            db.query(MessageTemplate)
            .filter(MessageTemplate.kind == "post_show_receipt")
            .first()
        )

    info = b.screening
    items_text = "\n".join(
        f"- {it.name} ×{it.qty} — {int(float(it.price_each) * it.qty)} ₽"
        for it in b.items
    )
    booking_link = f"{get_settings().APP_BASE_URL.rstrip('/')}/bookings/{b.id}"
    # Чек оформляется только на сумму, оплаченную «живыми» деньгами (без части с баланса).
    external_amount = max(0.0, float(b.total_amount) - float(b.balance_used or 0))
    ctx = {
        "full_name": b.full_name,
        "movie": info.movie.title if (info and info.movie) else "",
        "starts_at": info.starts_at.strftime("%d.%m.%Y %H:%M") if info else "",
        "rooftop": info.rooftop.name if (info and info.rooftop) else "",
        "city": info.rooftop.city.name if (info and info.rooftop and info.rooftop.city) else "",
        "items": items_text,
        "amount": f"{int(external_amount)}",
        "booking_link": booking_link,
    }

    if tpl:
        return render_template(tpl.text, ctx)
    return (
        f"Здравствуйте, {b.full_name}!\n\n"
        f"Прикладываем чек по вашему бронированию на показ "
        f"«{ctx['movie']}» ({ctx['starts_at']}, {ctx['rooftop']}).\n\n"
        f"Спасибо, что были с нами!"
    )


def _screening_has_ended(b: Booking) -> bool:
    """True если показ уже закончился. Используется чтобы решить, отправлять ли чек
    сразу или ждать. Сравниваем в локальном времени крыши.

    Окончание: явный ends_at → длительность фильма → 3ч по умолчанию."""
    s = b.screening
    if s is None:
        return False
    tz_name = (
        s.rooftop.city.timezone
        if s.rooftop and s.rooftop.city else None
    )
    local_now = now_in_tz(tz_name)
    if s.ends_at:
        end = s.ends_at
    elif s.movie and s.movie.duration_min:
        end = s.starts_at + timedelta(minutes=int(s.movie.duration_min))
    else:
        end = s.starts_at + timedelta(hours=3)
    return end <= local_now


def _send_post_show_email(db: Session, b: Booking) -> bool:
    """Шлёт пользователю письмо с прикреплённым файлом чека и проставляет sent_at."""
    if not b.post_show_receipt or not b.post_show_receipt.file_url:
        return False
    # Превращаем /uploads/<name> в абсолютный путь до файла
    file_url = b.post_show_receipt.file_url
    rel = file_url.lstrip("/")
    if rel.startswith("uploads/"):
        rel = rel[len("uploads/"):]
    path = UPLOAD_DIR / rel
    if not path.exists():
        return False

    ext = path.suffix.lstrip(".") or "pdf"
    body_text = _render_post_show_receipt_text(db, b)
    subject = "Чек по вашему бронированию — Кино на крыше"
    attachment_name = f"receipt_{b.short_code or b.id}.{ext}"

    ok = send_email_with_attachment(
        to=b.email,
        subject=subject,
        body_text=body_text,
        body_html=None,
        attachment_path=path,
        attachment_name=attachment_name,
    )
    if ok:
        b.post_show_receipt.sent_at = datetime.utcnow()
        db.commit()
    return ok


@router.post("/{booking_id}/send")
async def upload_and_send(
    booking_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_perm("manage_receipts")),
):
    """Принимает файл чека и сохраняет его. Если показ уже закончился — сразу шлёт
    письмо пользователю. Если ещё нет — фоновая задача отправит после окончания."""
    b = (
        _bookings_query(db)
        .filter(Booking.id == booking_id)
        .first()
    )
    if not b:
        raise HTTPException(status_code=404, detail="Бронь не найдена или не требует пост-чека")
    if b.post_show_receipt and b.post_show_receipt.sent_at:
        raise HTTPException(status_code=400, detail="Чек уже отправлен")

    # Проверка файла
    if file.filename and "." in file.filename:
        ext = file.filename.rsplit(".", 1)[1].lower()
    else:
        ct = (file.content_type or "").lower()
        ext = ct.split("/", 1)[1].split(";", 1)[0] if "/" in ct else ""
    if ext == "jpeg":
        ext = "jpg"
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Поддерживаются: {', '.join(sorted(ALLOWED_EXT))}",
        )

    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=413, detail=f"Файл слишком большой (макс {MAX_SIZE // 1024 // 1024} МБ)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Файл пустой")

    name = f"receipt_{booking_id}_{secrets.token_urlsafe(8)}.{ext}"
    path = UPLOAD_DIR / name
    path.write_bytes(data)
    file_url = f"/uploads/{name}"

    # Сохраняем (или обновляем) запись PostShowReceipt
    if b.post_show_receipt:
        b.post_show_receipt.file_url = file_url
        b.post_show_receipt.sent_by_admin_id = admin.id
    else:
        b.post_show_receipt = PostShowReceipt(
            booking_id=b.id,
            file_url=file_url,
            sent_by_admin_id=admin.id,
        )
        db.add(b.post_show_receipt)
    db.flush()

    # Если показ уже завершён — отправляем письмо сразу
    if _screening_has_ended(b):
        ok = _send_post_show_email(db, b)
        if not ok:
            raise HTTPException(status_code=502, detail="Не удалось отправить письмо. Файл сохранён, попробуйте позже.")
        return {
            "ok": True,
            "file_url": file_url,
            "sent_at": b.post_show_receipt.sent_at.isoformat() if b.post_show_receipt.sent_at else None,
            "deferred": False,
        }

    db.commit()
    return {
        "ok": True,
        "file_url": file_url,
        "sent_at": None,
        "deferred": True,  # отправится автоматически после окончания показа
    }
