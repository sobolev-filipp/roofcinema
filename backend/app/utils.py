"""Утилиты общего назначения."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Mapping

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore


def now_in_tz(tz_name: str | None) -> datetime:
    """Текущее «локальное наивное» время в указанном IANA-часовом поясе.

    Используется для сравнения со «screening.starts_at» / «booking_opens_at» /
    «booking_closes_at», которые по конвенции хранятся как наивное локальное
    время в часовом поясе крыши (см. docstring Screening). НЕ для сравнения с
    UTC-полями типа Booking.expires_at — те остаются как datetime.utcnow().
    """
    if not tz_name or ZoneInfo is None:
        return datetime.utcnow()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        return datetime.utcnow()
    return datetime.now(tz).replace(tzinfo=None)

# Базовая транслитерация ГОСТ-ish для slug. Без зависимостей.
_CYR_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify(value: str) -> str:
    """Превратить произвольную строку (включая кириллицу) в URL-slug:
    только [a-z0-9-], без двойных дефисов, без хвостовых дефисов."""
    s = (value or "").strip().lower()
    out: list[str] = []
    for ch in s:
        if ch in _CYR_MAP:
            out.append(_CYR_MAP[ch])
        elif ch.isalnum() and ord(ch) < 128:
            out.append(ch)
        else:
            out.append("-")
    result = "".join(out)
    result = re.sub(r"-+", "-", result).strip("-")
    return result or "item"


# Российские часовые пояса для UI-выбора.
# (value — IANA tz, label — что показываем пользователю)
RU_TIMEZONES: list[dict[str, str]] = [
    {"value": "Europe/Kaliningrad", "label": "Калининград (UTC+2)"},
    {"value": "Europe/Moscow",      "label": "Москва (UTC+3)"},
    {"value": "Europe/Samara",      "label": "Самара / Ижевск (UTC+4)"},
    {"value": "Asia/Yekaterinburg", "label": "Екатеринбург (UTC+5)"},
    {"value": "Asia/Omsk",          "label": "Омск (UTC+6)"},
    {"value": "Asia/Krasnoyarsk",   "label": "Красноярск (UTC+7)"},
    {"value": "Asia/Irkutsk",       "label": "Иркутск (UTC+8)"},
    {"value": "Asia/Yakutsk",       "label": "Якутск (UTC+9)"},
    {"value": "Asia/Vladivostok",   "label": "Владивосток (UTC+10)"},
    {"value": "Asia/Magadan",       "label": "Магадан / Сахалин (UTC+11)"},
    {"value": "Asia/Kamchatka",     "label": "Камчатка / Чукотка (UTC+12)"},
]


RU_TZ_VALUES = {tz["value"] for tz in RU_TIMEZONES}


# === Шаблоны сообщений ===

# Какие плейсхолдеры доступны для каждого kind. Используется и backend'ом
# (валидация/документация), и frontend'ом (показ кликабельных бейджей).
TEMPLATE_PLACEHOLDERS: dict[str, list[str]] = {
    "manual_booking": [
        "{full_name}", "{movie}", "{starts_at}", "{ends_at}",
        "{rooftop}", "{rooftop_address}", "{city}",
        "{amount}", "{expires_at}", "{booking_link}", "{claim_link}",
        "{payout_details}", "{items}",
    ],
    "pre_booking_info": [
        # Этот шаблон копируется ДО бронирования — данных о пользователе/деньгах ещё нет.
        # Доступны только данные показа + актуальный список типов мест с ценами и остатком.
        "{movie}", "{starts_at}", "{rooftop}", "{city}", "{seat_types}",
    ],
    "post_payment": [
        "{full_name}", "{movie}", "{starts_at}", "{ends_at}",
        "{rooftop}", "{city}",
        "{rooftop_address}", "{short_code}", "{qr_image_link}", "{items}",
        "{booking_link}",
    ],
    "post_show_receipt": [
        # Сопровождение чека после показа — текст письма, к которому прикладывается файл.
        # Сам файл чека добавляется автоматически как вложение — указывать его в тексте не нужно.
        "{full_name}", "{movie}", "{starts_at}", "{rooftop}", "{city}",
        "{items}", "{amount}", "{booking_link}",
    ],
    "payment_reminder": [
        # Напоминание оплатить бронь, когда осталось < 25% времени.
        # minutes_left — сколько минут осталось до истечения брони (целое число).
        "{full_name}", "{movie}", "{starts_at}", "{rooftop}", "{city}",
        "{items}", "{amount}", "{expires_at}", "{minutes_left}", "{booking_link}",
    ],
    "welcome_on_checkin": [
        # Приветствие при сканировании QR / вводе кода брони — гость пришёл.
        "{full_name}", "{movie}", "{starts_at}", "{ends_at}",
        "{rooftop}", "{city}", "{rooftop_address}",
    ],
    "user_cancel_notice": [
        "{full_name}", "{movie}", "{starts_at}", "{rooftop}", "{reason}",
    ],
    "admin_cancel_screening": [
        "{full_name}", "{movie}", "{starts_at}", "{rooftop}", "{reason}",
    ],
    "refund_link": [
        "{full_name}", "{movie}", "{amount}", "{refund_link}",
    ],
    "custom": [
        "{full_name}", "{movie}", "{starts_at}", "{rooftop}", "{city}",
        "{amount}", "{booking_link}", "{claim_link}", "{refund_link}", "{reason}",
        "{short_code}", "{qr_image_link}",
    ],
}


_PLACEHOLDER_RX = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def render_template(text: str, context: Mapping[str, Any]) -> str:
    """Подставляет {key} в text значениями из context.
    Неизвестные ключи остаются как есть (чтобы админ заметил опечатку).
    None заменяется на пустую строку."""
    if not text:
        return ""

    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in context:
            v = context[key]
            return "" if v is None else str(v)
        return match.group(0)

    return _PLACEHOLDER_RX.sub(repl, text)
