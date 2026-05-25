"""Типы мест на крыше: добавление, редактирование, удаление.
При удалении используемого в показах типа выполняем мягкое удаление (is_active=False)
— исторические показы продолжают работать со снапшотом ScreeningSeatType."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import Rooftop, RooftopAdmin, ScreeningSeatType, SeatType, User, UserRole
from ..schemas import SeatTypeIn, SeatTypeOut, SeatTypeUpdateIn

router = APIRouter(prefix="/api/rooftops/{rooftop_id}/seat-types", tags=["seat-types"])


def _check_manage(db: Session, user: User, rooftop_id: int) -> None:
    if user.role == UserRole.super_admin.value:
        return
    if user.role == UserRole.admin.value:
        link = (
            db.query(RooftopAdmin)
            .filter(
                RooftopAdmin.user_id == user.id,
                RooftopAdmin.rooftop_id == rooftop_id,
                RooftopAdmin.can_manage_movies.is_(True),
            )
            .first()
        )
        if link:
            return
    raise HTTPException(status_code=403, detail="Нет прав на управление этой крышей")


@router.get("", response_model=list[SeatTypeOut])
def list_seat_types(
    rooftop_id: int,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    if not db.get(Rooftop, rooftop_id):
        raise HTTPException(status_code=404, detail="Крыша не найдена")
    q = db.query(SeatType).filter(SeatType.rooftop_id == rooftop_id)
    if not include_inactive:
        q = q.filter(SeatType.is_active.is_(True))
    return q.order_by(SeatType.id).all()


@router.post("", response_model=SeatTypeOut, status_code=201)
def create_seat_type(
    rooftop_id: int,
    payload: SeatTypeIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not db.get(Rooftop, rooftop_id):
        raise HTTPException(status_code=404, detail="Крыша не найдена")
    _check_manage(db, user, rooftop_id)
    st = SeatType(rooftop_id=rooftop_id, **payload.model_dump())
    db.add(st)
    db.commit()
    db.refresh(st)
    return st


@router.patch("/{seat_type_id}", response_model=SeatTypeOut)
def update_seat_type(
    rooftop_id: int,
    seat_type_id: int,
    payload: SeatTypeUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _check_manage(db, user, rooftop_id)
    st = db.get(SeatType, seat_type_id)
    if not st or st.rooftop_id != rooftop_id:
        raise HTTPException(status_code=404, detail="Тип места не найден")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(st, k, v)
    db.commit()
    db.refresh(st)
    return st


@router.delete("/{seat_type_id}")
def delete_seat_type(
    rooftop_id: int,
    seat_type_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _check_manage(db, user, rooftop_id)
    st = db.get(SeatType, seat_type_id)
    if not st or st.rooftop_id != rooftop_id:
        raise HTTPException(status_code=404, detail="Тип места не найден")
    in_use = (
        db.query(ScreeningSeatType)
        .filter(ScreeningSeatType.seat_type_id == seat_type_id)
        .count()
    )
    if in_use:
        # мягкое удаление — не показываем в новых показах, но сохраняем для исторических
        st.is_active = False
        db.commit()
        return {"deleted": False, "deactivated": True, "in_use_count": in_use}
    db.delete(st)
    db.commit()
    return {"deleted": True, "deactivated": False, "in_use_count": 0}
