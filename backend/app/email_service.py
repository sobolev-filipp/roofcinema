"""Простой email-сервис: если в .env заданы SMTP_HOST/USER/PASSWORD — шлёт реальные письма,
иначе в dev-режиме выводит письмо в консоль (с пометкой [DEV-EMAIL])."""
from __future__ import annotations

import logging
import mimetypes
import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path

from .config import get_settings

log = logging.getLogger("email")


def send_email(to: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Отправляет письмо. Возвращает True если отправили (или вывели в консоль)."""
    s = get_settings()
    if not s.SMTP_HOST:
        # dev-режим
        log.warning("[DEV-EMAIL] To: %s | Subject: %s\n%s\n-----", to, subject, body_text)
        print(f"\n[DEV-EMAIL]\nTo: {to}\nSubject: {subject}\n\n{body_text}\n-----\n", flush=True)
        return True

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = formataddr(("Кино на крыше", s.SMTP_FROM))
        msg["To"] = to
        msg.attach(MIMEText(body_text, "plain", "utf-8"))
        if body_html:
            msg.attach(MIMEText(body_html, "html", "utf-8"))

        with smtplib.SMTP(s.SMTP_HOST, s.SMTP_PORT, timeout=15) as smtp:
            if s.SMTP_USE_TLS:
                smtp.starttls()
            if s.SMTP_USER:
                smtp.login(s.SMTP_USER, s.SMTP_PASSWORD)
            smtp.sendmail(s.SMTP_FROM, [to], msg.as_string())
        return True
    except Exception as e:
        log.exception("SMTP send failed: %s", e)
        return False


def send_verification_code(email: str, code: str) -> None:
    body = (
        f"Здравствуйте!\n\n"
        f"Код подтверждения email: {code}\n\n"
        f"Введите его на странице регистрации. Код действует 10 минут.\n\n"
        f"Если вы не регистрировались — просто проигнорируйте письмо."
    )
    send_email(email, "Подтверждение email — Кино на крыше", body)


def send_password_reset(email: str, link: str) -> None:
    body = (
        f"Здравствуйте!\n\n"
        f"Вы запросили сброс пароля. Перейдите по ссылке (действует 1 час):\n\n"
        f"{link}\n\n"
        f"Если вы не запрашивали сброс — просто проигнорируйте письмо."
    )
    send_email(email, "Сброс пароля — Кино на крыше", body)


def send_login_code(email: str, code: str) -> None:
    body = (
        f"Здравствуйте!\n\n"
        f"Код для входа в аккаунт: {code}\n\n"
        f"Введите его на странице входа. Код действует 5 минут.\n\n"
        f"Если вы не пытались войти — немедленно смените пароль: кто-то знает ваши данные."
    )
    html = (
        f"<p>Здравствуйте!</p>"
        f"<p>Ваш код для входа:</p>"
        f"<h1 style='letter-spacing:8px;font-size:36px;font-family:monospace;color:#6d28d9'>{code}</h1>"
        f"<p>Код действует <b>5 минут</b>.</p>"
        f"<p style='color:#888;font-size:13px'>Если вы не пытались войти — немедленно смените пароль.</p>"
    )
    send_email(email, "Код для входа — Кино на крыше", body, html)


def send_payment_approved(email: str, movie_title: str, starts_at_text: str, booking_id: int, short_code: str) -> None:
    body = (
        f"Здравствуйте!\n\n"
        f"Оплата по брони #{booking_id} подтверждена.\n"
        f"Фильм: {movie_title}\n"
        f"Начало: {starts_at_text}\n"
        f"Код брони: {short_code}\n\n"
        f"Билет доступен в разделе «Мои билеты». До встречи на крыше!"
    )
    send_email(email, "Оплата подтверждена — Кино на крыше", body)


def send_booking_window_opened(email: str, movie_title: str, starts_at_text: str, link: str) -> None:
    body = (
        f"Здравствуйте!\n\n"
        f"Открылось бронирование на показ:\n"
        f"  {movie_title}\n"
        f"  Начало: {starts_at_text}\n\n"
        f"Забронировать место можно по ссылке:\n{link}\n\n"
        f"Места уходят быстро — не откладывайте."
    )
    send_email(email, "Открылось бронирование — Кино на крыше", body)


def send_attendee_invite(
    email: str,
    movie_title: str,
    starts_at_text: str,
    rooftop_name: str,
    guests_count: int,
    claim_url: str,
    short_code: str,
    main_booker_name: str,
    is_paid: bool,
) -> None:
    """Письмо гостю, на которого «разделили» часть брони.
    Если бронь оплачена — присылаем код входа; иначе только инфу и ссылку."""
    payment_line = (
        f"Код для входа (если QR не считается): {short_code}"
        if is_paid
        else "Билет станет активен, когда организатор подтвердит оплату — мы вышлем повторное письмо с QR."
    )
    body = (
        f"Здравствуйте!\n\n"
        f"{main_booker_name} пригласил(а) вас на показ:\n"
        f"  {movie_title}\n"
        f"  Начало: {starts_at_text}\n"
        f"  Место: {rooftop_name}\n"
        f"  Гостей по этой брони: {guests_count}\n\n"
        f"Ваш билет (откройте ссылку — её можно сохранить или привязать к аккаунту):\n"
        f"{claim_url}\n\n"
        f"{payment_line}\n"
    )
    send_email(email, "Вас пригласили на показ — Кино на крыше", body)


def send_email_with_attachment(
    to: str,
    subject: str,
    body_text: str,
    body_html: str | None,
    attachment_path: Path,
    attachment_name: str,
) -> bool:
    """Письмо с прикреплённым файлом (чек/PDF/JPG). Используется для post-show receipts.
    Возвращает True при успехе. В dev-режиме (без SMTP_HOST) пишет в лог."""
    s = get_settings()
    if not s.SMTP_HOST:
        log.warning(
            "[DEV-EMAIL] To: %s | Subject: %s | Attachment: %s\n%s\n-----",
            to, subject, attachment_name, body_text,
        )
        print(
            f"\n[DEV-EMAIL]\nTo: {to}\nSubject: {subject}\nAttachment: {attachment_name}\n\n{body_text}\n-----\n",
            flush=True,
        )
        return True

    try:
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = formataddr(("Кино на крыше", s.SMTP_FROM))
        msg["To"] = to

        # Текстовое + HTML тело — в подмножестве alternative
        body_part = MIMEMultipart("alternative")
        body_part.attach(MIMEText(body_text, "plain", "utf-8"))
        if body_html:
            body_part.attach(MIMEText(body_html, "html", "utf-8"))
        msg.attach(body_part)

        # Файл вложения
        mime_type, _ = mimetypes.guess_type(str(attachment_path))
        if mime_type:
            main_type, sub_type = mime_type.split("/", 1)
        else:
            main_type, sub_type = "application", "octet-stream"
        with open(attachment_path, "rb") as f:
            payload = f.read()
        part = MIMEBase(main_type, sub_type)
        part.set_payload(payload)
        encoders.encode_base64(part)
        part.add_header(
            "Content-Disposition",
            f'attachment; filename="{attachment_name}"',
        )
        msg.attach(part)

        with smtplib.SMTP(s.SMTP_HOST, s.SMTP_PORT, timeout=30) as smtp:
            if s.SMTP_USE_TLS:
                smtp.starttls()
            if s.SMTP_USER:
                smtp.login(s.SMTP_USER, s.SMTP_PASSWORD)
            smtp.sendmail(s.SMTP_FROM, [to], msg.as_string())
        return True
    except Exception as e:
        log.exception("SMTP send (with attachment) failed: %s", e)
        return False


def send_post_show_receipt_pending_digest(
    admin_email: str,
    pending: list[dict],
    admin_link: str,
) -> None:
    """Письмо администратору со списком броней, для которых нужно прикрепить чек.
    pending = [{"id", "full_name", "email", "movie", "starts_at", "rooftop"}, ...]"""
    lines = ["Здравствуйте!", ""]
    lines.append("После окончания показов не для всех броней с заказанным чеком был прикреплён файл:")
    lines.append("")
    for p in pending:
        lines.append(
            f"  • #{p['id']} — {p['full_name']} ({p['email']})"
        )
        lines.append(
            f"    «{p['movie']}» · {p['starts_at']} · {p['rooftop']}"
        )
    lines.append("")
    lines.append(f"Прикрепить чеки можно здесь: {admin_link}")
    lines.append("")
    lines.append("Это уведомление автоматическое — приходит один раз по каждой брони.")
    body = "\n".join(lines)
    send_email(admin_email, "Напоминание: нужно прикрепить чеки", body)


def send_payment_rejected(email: str, movie_title: str, booking_id: int, reason: str) -> None:
    body = (
        f"Здравствуйте!\n\n"
        f"К сожалению, по брони #{booking_id} ({movie_title}) оплата не подтверждена.\n\n"
        f"Причина: {reason}\n\n"
        f"Вы можете загрузить новый чек в разделе брони — таймер ещё идёт. "
        f"Если возникли вопросы — свяжитесь с организатором."
    )
    send_email(email, "Чек не подтверждён — Кино на крыше", body)
