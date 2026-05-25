"""Простой email-сервис: если в .env заданы SMTP_HOST/USER/PASSWORD — шлёт реальные письма,
иначе в dev-режиме выводит письмо в консоль (с пометкой [DEV-EMAIL])."""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

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
