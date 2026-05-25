"""Перезаливка демо-данных для разработки.
Удаляет существующие записи и создаёт минимальный набор для проверки UI."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal  # noqa: E402
from app.models import City, Movie, MovieStill, Rooftop, Screening, ScreeningSeatType, SeatType  # noqa: E402

db = SessionLocal()
try:
    # очищаем демо-данные (в порядке зависимостей)
    db.query(ScreeningSeatType).delete()
    db.query(Screening).delete()
    db.query(SeatType).delete()
    db.query(MovieStill).delete()
    db.query(Movie).delete()
    db.query(Rooftop).delete()
    db.query(City).delete()
    db.commit()

    msk = City(name="Москва", slug="msk", timezone="Europe/Moscow")
    spb = City(name="Санкт-Петербург", slug="spb", timezone="Europe/Moscow")
    db.add_all([msk, spb])
    db.flush()

    loft = Rooftop(
        city_id=msk.id,
        name="Крыша Лофт",
        address="ул. Тверская, 1",
        description="Большая крыша с панорамным видом на центр Москвы.",
        lat=55.7558,
        lng=37.6173,
    )
    panorama = Rooftop(
        city_id=msk.id,
        name="Панорама",
        address="ул. Большая Никитская, 12",
        description="Камерная крыша с видом на Кремль.",
        lat=55.7558,
        lng=37.6043,
    )
    spb_roof = Rooftop(
        city_id=spb.id,
        name="Крыша на Невском",
        address="Невский проспект, 28",
        description="Крыша в центре Санкт-Петербурга.",
        lat=59.9343,
        lng=30.3351,
    )
    db.add_all([loft, panorama, spb_roof])
    db.flush()

    # типы мест на крышах
    seat_types_per_rooftop: dict[int, list[SeatType]] = {}
    for rooftop in [loft, panorama, spb_roof]:
        sts = [
            SeatType(rooftop_id=rooftop.id, name="Кресло-мешок", default_price=800, default_count=20),
            SeatType(rooftop_id=rooftop.id, name="Шезлонг",      default_price=1200, default_count=10),
            SeatType(rooftop_id=rooftop.id, name="VIP-диван",    default_price=2500, default_count=4),
        ]
        db.add_all(sts)
        seat_types_per_rooftop[rooftop.id] = sts
    db.flush()

    fight_club = Movie(
        title="Бойцовский клуб",
        original_title="Fight Club",
        description=(
            "Скучающий клерк страдает от бессонницы и встречает харизматичного "
            "продавца мыла Тайлера Дёрдена. Вместе они основывают подпольный "
            "клуб, где мужчины собираются, чтобы драться и почувствовать себя живыми."
        ),
        poster_url="https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
        trailer_url="https://www.youtube.com/watch?v=qtRKdVHc-cE",
        duration_min=139,
        year=1999,
        age_rating="18+",
        genres="драма, триллер",
        director="Дэвид Финчер",
        imdb_id="tt0137523",
        imdb_rating=8.8,
        kinopoisk_rating=8.7,
    )
    inception = Movie(
        title="Начало",
        original_title="Inception",
        description=(
            "Опытный вор Дом Кобб умеет проникать в чужие сны и красть идеи. "
            "Ему предлагают невозможное задание — внедрить идею в подсознание наследника корпорации."
        ),
        poster_url="https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
        trailer_url="https://www.youtube.com/watch?v=YoHD9XEInc0",
        duration_min=148,
        year=2010,
        age_rating="12+",
        genres="фантастика, боевик",
        director="Кристофер Нолан",
        imdb_id="tt1375666",
        imdb_rating=8.8,
        kinopoisk_rating=8.6,
    )
    db.add_all([fight_club, inception])
    db.flush()

    db.add_all([
        MovieStill(movie_id=fight_club.id, image_url="https://image.tmdb.org/t/p/w780/52AfXWuXCHn3UjD17rBruA9f5qb.jpg", position=1),
        MovieStill(movie_id=fight_club.id, image_url="https://image.tmdb.org/t/p/w780/8Aix6Hu2N1RKgD1WkN4dEZcVStY.jpg", position=2),
        MovieStill(movie_id=inception.id, image_url="https://image.tmdb.org/t/p/w780/s3TBrRGB1iav7gFOCNx3H31MoES.jpg", position=1),
    ])

    db.add_all([
        Screening(movie_id=fight_club.id, rooftop_id=loft.id, starts_at_iso="2026-05-23T21:30:00", booking_window_minutes=120, base_price=800),
        Screening(movie_id=fight_club.id, rooftop_id=panorama.id, starts_at_iso="2026-05-24T22:00:00", booking_window_minutes=120, base_price=1000),
        Screening(movie_id=inception.id, rooftop_id=loft.id, starts_at_iso="2026-05-25T21:00:00", booking_window_minutes=120, base_price=900),
        Screening(movie_id=inception.id, rooftop_id=spb_roof.id, starts_at_iso="2026-05-26T21:30:00", booking_window_minutes=120, base_price=850),
    ]) if False else None  # см. ниже — Screening использует datetime, не строку

    from datetime import datetime

    screenings = [
        Screening(movie_id=fight_club.id, rooftop_id=loft.id,
                  starts_at=datetime(2026, 5, 23, 21, 30),
                  booking_window_minutes=120, base_price=800),
        Screening(movie_id=fight_club.id, rooftop_id=panorama.id,
                  starts_at=datetime(2026, 5, 24, 22, 0),
                  booking_window_minutes=120, base_price=1000),
        Screening(movie_id=inception.id, rooftop_id=loft.id,
                  starts_at=datetime(2026, 5, 25, 21, 0),
                  booking_window_minutes=120, base_price=900),
        Screening(movie_id=inception.id, rooftop_id=spb_roof.id,
                  starts_at=datetime(2026, 5, 26, 21, 30),
                  booking_window_minutes=120, base_price=850),
    ]
    db.add_all(screenings)
    db.flush()

    # на каждый показ — снапшоты типов мест с дефолтными ценами/количествами
    for s in screenings:
        for st in seat_types_per_rooftop[s.rooftop_id]:
            db.add(ScreeningSeatType(
                screening_id=s.id, seat_type_id=st.id, name=st.name,
                price=float(st.default_price), count=st.default_count,
            ))

    db.commit()
    print("Seeded:")
    print(f"  cities: {db.query(City).count()}")
    print(f"  rooftops: {db.query(Rooftop).count()}")
    print(f"  movies: {db.query(Movie).count()}")
    print(f"  stills: {db.query(MovieStill).count()}")
    print(f"  screenings: {db.query(Screening).count()}")
finally:
    db.close()
