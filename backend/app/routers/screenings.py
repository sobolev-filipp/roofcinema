from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, selectinload

from ..db import get_db
from ..deps import require_admin_or_super
from ..models import Movie, Rooftop, Screening, ScreeningSeatType, SeatType
from ..schemas import ScreeningIn, ScreeningOut, ScreeningSeatTypeIn, ScreeningUpdateIn

router = APIRouter(prefix="/api/screenings", tags=["screenings"])


def _eager() -> list:
    # seats — one-to-many, нужен selectinload, иначе joinedload даст дубликаты строк.
    return [
        joinedload(Screening.movie),
        joinedload(Screening.rooftop),
        selectinload(Screening.seats),
    ]


def _apply_seat_allocations(
    db: Session, screening: Screening, allocations: list[ScreeningSeatTypeIn]
) -> None:
    """Заменяет аллокации мест для показа. Делает снапшот name из SeatType."""
    # очищаем существующие
    db.query(ScreeningSeatType).filter(ScreeningSeatType.screening_id == screening.id).delete()
    for alloc in allocations:
        st = db.get(SeatType, alloc.seat_type_id)
        if not st or st.rooftop_id != screening.rooftop_id:
            raise HTTPException(status_code=400, detail=f"Тип места {alloc.seat_type_id} не принадлежит этой крыше")
        db.add(ScreeningSeatType(
            screening_id=screening.id,
            seat_type_id=st.id,
            name=st.name,
            price=alloc.price,
            count=alloc.count,
        ))


@router.get("", response_model=list[ScreeningOut])
def list_screenings(
    city_id: int | None = None,
    rooftop_id: int | None = None,
    movie_id: int | None = None,
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    """Список показов с фильтрами. starts_at трактуется как локальное время крыши,
    клиент передаёт диапазон в том же представлении."""
    query = db.query(Screening).options(*_eager())
    if not include_inactive:
        query = query.filter(Screening.is_active.is_(True))
    if city_id is not None:
        query = query.join(Rooftop, Screening.rooftop_id == Rooftop.id).filter(Rooftop.city_id == city_id)
    if rooftop_id is not None:
        query = query.filter(Screening.rooftop_id == rooftop_id)
    if movie_id is not None:
        query = query.filter(Screening.movie_id == movie_id)
    if date_from is not None:
        query = query.filter(Screening.starts_at >= date_from)
    if date_to is not None:
        query = query.filter(Screening.starts_at < date_to)
    return query.order_by(Screening.starts_at).all()


@router.get("/{screening_id}", response_model=ScreeningOut)
def get_screening(screening_id: int, db: Session = Depends(get_db)):
    screening = (
        db.query(Screening).options(*_eager()).filter(Screening.id == screening_id).first()
    )
    if not screening:
        raise HTTPException(status_code=404, detail="Показ не найден")
    return screening


@router.post("", response_model=ScreeningOut, status_code=201, dependencies=[Depends(require_admin_or_super)])
def create_screening(payload: ScreeningIn, db: Session = Depends(get_db)):
    if not db.get(Movie, payload.movie_id):
        raise HTTPException(status_code=400, detail="Фильм не найден")
    if not db.get(Rooftop, payload.rooftop_id):
        raise HTTPException(status_code=400, detail="Крыша не найдена")
    starts_at = payload.starts_at.replace(tzinfo=None)
    data = payload.model_dump(exclude={"seat_allocations"})
    data["starts_at"] = starts_at
    screening = Screening(**data)
    db.add(screening)
    db.flush()
    _apply_seat_allocations(db, screening, payload.seat_allocations)
    db.commit()
    return db.query(Screening).options(*_eager()).filter(Screening.id == screening.id).first()


@router.patch("/{screening_id}", response_model=ScreeningOut, dependencies=[Depends(require_admin_or_super)])
def update_screening(screening_id: int, payload: ScreeningUpdateIn, db: Session = Depends(get_db)):
    screening = db.get(Screening, screening_id)
    if not screening:
        raise HTTPException(status_code=404, detail="Показ не найден")
    data = payload.model_dump(exclude_unset=True, exclude={"seat_allocations"})
    if "starts_at" in data and data["starts_at"] is not None:
        data["starts_at"] = data["starts_at"].replace(tzinfo=None)
    for k, v in data.items():
        setattr(screening, k, v)
    if payload.seat_allocations is not None:
        _apply_seat_allocations(db, screening, payload.seat_allocations)
    db.commit()
    return db.query(Screening).options(*_eager()).filter(Screening.id == screening.id).first()


@router.delete("/{screening_id}", status_code=204, dependencies=[Depends(require_admin_or_super)])
def delete_screening(screening_id: int, db: Session = Depends(get_db)):
    screening = db.get(Screening, screening_id)
    if not screening:
        raise HTTPException(status_code=404, detail="Показ не найден")
    db.delete(screening)
    db.commit()
