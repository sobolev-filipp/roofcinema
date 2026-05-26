"""Эндпоинты статистики для админ-панели.

Агрегируем данные по показам/гостям/выручке/отменам в бакеты (месяц или неделя).
Заходит только тот, у кого есть право `view_statistics` (или super_admin)."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, selectinload

from ..db import get_db
from ..deps import require_perm
from ..models import Booking, BookingItem, BookingTransfer, Screening

router = APIRouter(
    prefix="/api/admin/statistics",
    tags=["admin-statistics"],
    dependencies=[Depends(require_perm("view_statistics"))],
)

# Статусы, которые считаются «оплаченными» — для выручки и подсчёта посетителей
_PAID_STATUSES = {"paid", "paid_by_balance", "attended"}

# Локализованные сокращения месяцев
_MONTHS_RU = [
    "янв", "фев", "мар", "апр", "май", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек",
]


def _format_label(start: date, end: date, period: str) -> str:
    """Метка бакета для оси X."""
    if period == "month":
        return f"{_MONTHS_RU[start.month - 1]} {start.year}"
    # week: «13–19 янв» или «27 янв–2 фев»
    last_day = end - timedelta(days=1)
    if start.month == last_day.month:
        return f"{start.day}–{last_day.day} {_MONTHS_RU[start.month - 1]}"
    return f"{start.day} {_MONTHS_RU[start.month - 1]}–{last_day.day} {_MONTHS_RU[last_day.month - 1]}"


def _build_buckets(period: str, end_date: date, count: int) -> list[tuple[date, date]]:
    """Возвращает список [(start, end), ...] от старого к новому.
    Полуинтервал [start, end) — end включает следующий день/месяц."""
    buckets: list[tuple[date, date]] = []
    if period == "month":
        cur = date(end_date.year, end_date.month, 1)
        for _ in range(count):
            nxt = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
            buckets.append((cur, nxt))
            cur = date(cur.year - 1, 12, 1) if cur.month == 1 else date(cur.year, cur.month - 1, 1)
    else:  # week
        monday = end_date - timedelta(days=end_date.weekday())  # понедельник этой недели
        cur = monday
        for _ in range(count):
            buckets.append((cur, cur + timedelta(days=7)))
            cur -= timedelta(days=7)
    buckets.reverse()
    return buckets


def _attendees_count(b: Booking) -> int:
    """Сколько гостей покрывает эта бронь = сумма qty × capacity по items.
    Для разделённых броней (booking_attendees) — итог тот же, поскольку attendee
    забирает места из основной брони, не добавляя новые."""
    total = 0
    for it in b.items:
        cap = 1
        if it.screening_seat_type is not None:
            cap = int(it.screening_seat_type.capacity or 1)
        total += int(it.qty) * cap
    return total


@router.get("")
def get_statistics(
    period: str = Query("month", pattern="^(month|week)$"),
    end_date: str | None = Query(None, description="Конечная дата YYYY-MM-DD; по умолчанию сегодня"),
    count: int = Query(12, ge=1, le=52, description="Сколько бакетов вернуть"),
    db: Session = Depends(get_db),
):
    """Агрегированная статистика по показам и броням.

    Бакетирование привязано к локальному (наивному) времени крыши:
    Screening.starts_at и Booking.cancelled_at используются как «дата события»
    в часовом поясе крыши без приведения к UTC. Это даёт привычные пользователю
    «месяцы» и «недели» без сюрпризов на границах суток."""
    today = date.today()
    if end_date:
        try:
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="end_date должен быть в формате YYYY-MM-DD")
    else:
        end = today

    buckets = _build_buckets(period, end, count)
    range_start = buckets[0][0]
    range_end = buckets[-1][1]
    range_start_dt = datetime(range_start.year, range_start.month, range_start.day)
    range_end_dt = datetime(range_end.year, range_end.month, range_end.day)

    # Показы в диапазоне — для подсчёта количества и привязки к бакетам
    screenings = (
        db.query(Screening)
        .filter(Screening.starts_at >= range_start_dt, Screening.starts_at < range_end_dt)
        .all()
    )
    scr_ids = [s.id for s in screenings]

    # Брони, привязанные к этим показам (для выручки и числа посетителей).
    # Грузим вместе с items + screening_seat_type, чтобы посчитать гостей без N+1.
    if scr_ids:
        bookings_paid = (
            db.query(Booking)
            .options(
                joinedload(Booking.screening),
                selectinload(Booking.items).joinedload(BookingItem.screening_seat_type),
            )
            .filter(
                Booking.screening_id.in_(scr_ids),
                Booking.status.in_(_PAID_STATUSES),
            )
            .all()
        )
    else:
        bookings_paid = []

    # Отмены — бронь считается отменённой в момент cancelled_at (а не starts_at).
    # Здесь правильнее фильтровать по диапазону именно cancelled_at.
    cancelled = (
        db.query(Booking)
        .filter(
            Booking.status == "cancelled",
            Booking.cancelled_at.is_not(None),
            Booking.cancelled_at >= range_start_dt,
            Booking.cancelled_at < range_end_dt,
        )
        .all()
    )

    # Переносы — записи в журнале booking_transfers. Привязка к бакету по created_at.
    transfers = (
        db.query(BookingTransfer)
        .filter(
            BookingTransfer.created_at >= range_start_dt,
            BookingTransfer.created_at < range_end_dt,
        )
        .all()
    )

    # Группируем по бакетам
    result = []
    for b_start, b_end in buckets:
        b_start_dt = datetime(b_start.year, b_start.month, b_start.day)
        b_end_dt = datetime(b_end.year, b_end.month, b_end.day)

        bucket_scrs = [s for s in screenings if b_start_dt <= s.starts_at < b_end_dt]
        scr_ids_in_bucket = {s.id for s in bucket_scrs}
        bucket_paid = [b for b in bookings_paid if b.screening_id in scr_ids_in_bucket]
        bucket_cancelled = [
            b for b in cancelled
            if b.cancelled_at is not None and b_start_dt <= b.cancelled_at < b_end_dt
        ]
        bucket_transfers = [
            t for t in transfers
            if b_start_dt <= t.created_at < b_end_dt
        ]

        attendees = sum(_attendees_count(b) for b in bucket_paid)
        revenue = sum(float(b.total_amount) for b in bucket_paid)

        result.append({
            "period_start": b_start.isoformat(),
            "period_end": (b_end - timedelta(days=1)).isoformat(),
            "label": _format_label(b_start, b_end, period),
            "screenings": len(bucket_scrs),
            "paid_bookings": len(bucket_paid),
            "attendees": attendees,
            "revenue": revenue,
            "cancellations": len(bucket_cancelled),
            "transfers": len(bucket_transfers),
        })

    totals = {
        "screenings": sum(r["screenings"] for r in result),
        "paid_bookings": sum(r["paid_bookings"] for r in result),
        "attendees": sum(r["attendees"] for r in result),
        "revenue": sum(r["revenue"] for r in result),
        "cancellations": sum(r["cancellations"] for r in result),
        "transfers": sum(r["transfers"] for r in result),
    }
    return {"period": period, "buckets": result, "totals": totals}
