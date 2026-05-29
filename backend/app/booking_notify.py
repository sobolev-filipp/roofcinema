"""Единая точка отправки писем по брони на основе шаблонов MessageTemplate.

Раньше рендер контекста дублировался в нескольких местах (напоминание об оплате,
пост-чек, приветствие). Здесь общий `build_booking_context` + `render_booking_template`,
которые покрывают все плейсхолдеры брони.
"""
from __future__ import annotations

from datetime import timedelta
from urllib.parse import quote

from sqlalchemy.orm import Session

from .config import get_settings
from .email_service import send_email
from .models import Booking, MessageTemplate
from .utils import render_template


def qr_image_url(token: str) -> str:
    """Прямая ссылка на картинку QR (тот же формат, что в админ-копировании)."""
    return (
        "https://api.qrserver.com/v1/create-qr-code/"
        f"?size=320x320&margin=10&qzone=1&color=111111&bgcolor=ffffff&data={quote(token)}"
    )


def _payout_details(b: Booking) -> str:
    s = b.screening
    pt = s.payout_template if s else None
    if not pt:
        return ""
    lines: list[str] = []
    if pt.recipient_name:
        lines.append(f"Получатель: {pt.recipient_name}")
    if pt.card_number:
        lines.append(f"Карта: {pt.card_number}")
    if pt.phone:
        lines.append(f"Телефон (СБП): {pt.phone}")
    if pt.bank_name:
        lines.append(f"Банк: {pt.bank_name}")
    if pt.note:
        lines.append(pt.note)
    return "\n".join(lines)


def build_booking_context(b: Booking, extra: dict | None = None) -> dict:
    """Полный набор плейсхолдеров по брони. Лишние ключи для конкретного шаблона
    не мешают — render_template подставит только встреченные в тексте."""
    s = b.screening
    base = get_settings().APP_BASE_URL.rstrip("/")
    starts_at = s.starts_at.strftime("%d.%m.%Y %H:%M") if s else ""
    ends_at = ""
    if s:
        end_dt = s.ends_at
        if end_dt is None and s.movie and s.movie.duration_min:
            end_dt = s.starts_at + timedelta(minutes=int(s.movie.duration_min))
        if end_dt:
            ends_at = end_dt.strftime("%d.%m.%Y %H:%M")
    items_text = "\n".join(
        f"- {it.name} ×{it.qty} — {int(float(it.price_each) * it.qty)} ₽" for it in b.items
    )
    ctx = {
        "full_name": b.full_name,
        "movie": s.movie.title if (s and s.movie) else "",
        "starts_at": starts_at,
        "ends_at": ends_at,
        "rooftop": s.rooftop.name if (s and s.rooftop) else "",
        "rooftop_address": (s.rooftop.address if (s and s.rooftop) else ""),
        "city": (s.rooftop.city.name if (s and s.rooftop and s.rooftop.city) else ""),
        "items": items_text,
        "amount": f"{int(float(b.total_amount))}",
        "expires_at": b.expires_at.strftime("%d.%m.%Y %H:%M") if b.expires_at else "",
        "short_code": b.short_code or "",
        "qr_image_link": qr_image_url(b.qr_token) if b.qr_token else "",
        "booking_link": f"{base}/bookings/{b.id}",
        "payout_details": _payout_details(b),
    }
    if extra:
        ctx.update(extra)
    return ctx


def render_booking_template(db: Session, kind: str, b: Booking, extra: dict | None = None) -> str | None:
    """Берёт дефолтный (или любой) шаблон kind и рендерит его контекстом брони.
    None если шаблона нет."""
    tpl = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.kind == kind, MessageTemplate.is_default.is_(True))
        .first()
    )
    if not tpl:
        tpl = db.query(MessageTemplate).filter(MessageTemplate.kind == kind).first()
    if not tpl:
        return None
    return render_template(tpl.text, build_booking_context(b, extra))


def send_post_payment_email(db: Session, b: Booking) -> None:
    """Письмо «После оплаты» по дефолтному шаблону post_payment.
    Если шаблона нет — отправляем краткий fallback. Никогда не бросает исключение
    наружу не должно блокировать смену статуса — оборачивайте вызов в try при желании."""
    body = render_booking_template(db, "post_payment", b)
    if not body:
        ctx = build_booking_context(b)
        body = (
            f"Здравствуйте, {ctx['full_name']}!\n\n"
            f"Оплата подтверждена. Ваш билет:\n"
            f"🎬 {ctx['movie']}\n"
            f"📅 {ctx['starts_at']}\n"
            f"📍 {ctx['rooftop']}, {ctx['city']}\n\n"
            f"Код входа: {ctx['short_code']}\n"
            f"Билет в личном кабинете: {ctx['booking_link']}\n"
        )
    send_email(b.email, "Оплата подтверждена — Кино на крыше", body)
