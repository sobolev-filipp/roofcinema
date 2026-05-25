"""Утилиты общего назначения."""
from __future__ import annotations

import re

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
