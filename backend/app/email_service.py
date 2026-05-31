"""Простой email-сервис: если в .env заданы SMTP_HOST/USER/PASSWORD — шлёт реальные письма,
иначе в dev-режиме выводит письмо в консоль (с пометкой [DEV-EMAIL])."""
from __future__ import annotations

import logging
import mimetypes
import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path

from .config import get_settings

log = logging.getLogger("email")


def _open_smtp(s, timeout: int = 30):
    """Открывает SMTP-соединение с правильным режимом шифрования.

    - порт 465 или SMTP_USE_SSL=true → implicit SSL (SMTP_SSL, без STARTTLS);
    - иначе обычный SMTP + STARTTLS (если SMTP_USE_TLS=true), типично порт 587.

    Логинится, если задан SMTP_USER. Возвращает готовый к sendmail объект."""
    use_ssl = bool(getattr(s, "SMTP_USE_SSL", False)) or int(s.SMTP_PORT) == 465
    if use_ssl:
        smtp = smtplib.SMTP_SSL(s.SMTP_HOST, s.SMTP_PORT, timeout=timeout)
    else:
        smtp = smtplib.SMTP(s.SMTP_HOST, s.SMTP_PORT, timeout=timeout)
        if s.SMTP_USE_TLS:
            smtp.starttls()
    if s.SMTP_USER:
        smtp.login(s.SMTP_USER, s.SMTP_PASSWORD)
    return smtp


def send_email(
    to: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    inline_images: dict[str, bytes] | None = None,
) -> bool:
    """Отправляет письмо. Возвращает True если отправили (или вывели в консоль).

    inline_images — встроенные картинки {cid: png_bytes}; на них можно ссылаться
    в body_html через <img src="cid:КЛЮЧ">. Используется для QR в письме «После оплаты»."""
    s = get_settings()
    if not s.SMTP_HOST:
        # dev-режим
        log.warning("[DEV-EMAIL] To: %s | Subject: %s\n%s\n-----", to, subject, body_text)
        print(f"\n[DEV-EMAIL]\nTo: {to}\nSubject: {subject}\n\n{body_text}\n-----\n", flush=True)
        return True

    try:
        # Структура: при наличии inline-картинок — multipart/related, внутри которого
        # multipart/alternative (text + html). Иначе обычный alternative.
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(body_text, "plain", "utf-8"))
        if body_html:
            alt.attach(MIMEText(body_html, "html", "utf-8"))

        if inline_images:
            msg = MIMEMultipart("related")
            msg.attach(alt)
            for cid, png in inline_images.items():
                img = MIMEImage(png, _subtype="png")
                img.add_header("Content-ID", f"<{cid}>")
                img.add_header("Content-Disposition", "inline", filename=f"{cid}.png")
                msg.attach(img)
        else:
            msg = alt

        msg["Subject"] = subject
        msg["From"] = formataddr(("Кино на крыше", s.SMTP_FROM))
        msg["To"] = to

        with _open_smtp(s) as smtp:
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

        with _open_smtp(s) as smtp:
            smtp.sendmail(s.SMTP_FROM, [to], msg.as_string())
        return True
    except Exception as e:
        log.exception("SMTP send (with attachment) failed: %s", e)
        return False


def send_template_email(to: str, subject: str, body_text: str) -> bool:
    """Простой обёртчик над send_email для шаблонных писем (без HTML/вложений)."""
    return send_email(to, subject, body_text)


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


def send_screening_summary(
    admin_email: str,
    *,
    movie_title: str,
    starts_at_text: str,
    rooftop_name: str,
    seat_lines: list[str],
    bookings_count: int,
    guests_count: int,
    total_amount: float,
) -> None:
    """Письмо-сводка администратору после закрытия бронирования на показ.
    seat_lines = ["Кресло-мешок ×3 — 4500 ₽", ...] (по типам мест)."""
    lines = ["Здравствуйте!", ""]
    lines.append("Бронирование на показ закрыто. Ниже — итоговая сводка по броням.")
    lines.append("")
    lines.append(f"«{movie_title}»")
    lines.append(f"{starts_at_text} · {rooftop_name}")
    lines.append("")
    if bookings_count == 0:
        lines.append("Броней на этот показ не было.")
    else:
        lines.append(f"Броней: {bookings_count} · гостей: {guests_count}")
        lines.append("")
        lines.append("Забронированные места:")
        for sl in seat_lines:
            lines.append(f"  • {sl}")
        lines.append("")
        lines.append(f"Общая сумма: {total_amount:.0f} ₽")
    body = "\n".join(lines)
    send_email(admin_email, f"Сводка по бронированиям: «{movie_title}» — Кино на крыше", body)


def send_payment_rejected(email: str, movie_title: str, booking_id: int, reason: str) -> None:
    body = (
        f"Здравствуйте!\n\n"
        f"К сожалению, по брони #{booking_id} ({movie_title}) оплата не подтверждена.\n\n"
        f"Причина: {reason}\n\n"
        f"Вы можете загрузить новый чек в разделе брони — таймер ещё идёт. "
        f"Если возникли вопросы — свяжитесь с организатором."
    )
    send_email(email, "Чек не подтверждён — Кино на крыше", body)
