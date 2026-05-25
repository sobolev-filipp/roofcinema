import hashlib
import math
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import get_current_user, get_current_user_optional, require_perm, require_super_admin
from ..models import (
    AdminPermission,
    Booking,
    BookingStatus,
    City,
    Rooftop,
    RooftopAdmin,
    RooftopAdminInvite,
    Screening,
    User,
    UserRole,
)
from ..schemas import InviteCreateIn, InviteOut, RooftopIn, RooftopOut, RooftopPublicOut, RooftopUpdateIn

router = APIRouter(prefix="/api/rooftops", tags=["rooftops"])


# === вспомогалки ===

def _user_can_see_address(db: Session, user: User | None, rooftop_id: int) -> bool:
    if not user:
        return False
    if user.role == UserRole.super_admin.value:
        return True
    if user.role == UserRole.admin.value:
        link = (
            db.query(RooftopAdmin)
            .filter(RooftopAdmin.user_id == user.id, RooftopAdmin.rooftop_id == rooftop_id)
            .first()
        )
        if link:
            return True
    # Пользователь с оплаченной (или посещённой) бронью на этой крыше видит адрес.
    has_booking = (
        db.query(Booking.id)
        .join(Screening, Booking.screening_id == Screening.id)
        .filter(
            Booking.user_id == user.id,
            Screening.rooftop_id == rooftop_id,
            Booking.status.in_([
                BookingStatus.paid.value,
                BookingStatus.attended.value,
                BookingStatus.paid_by_balance.value,
            ]),
        )
        .first()
    )
    if has_booking:
        return True
    return False


def _approx_center(lat: float | None, lng: float | None, rooftop_id: int) -> tuple[float | None, float | None]:
    """Детерминированно сдвигает центр на 1.0–2.5 км в случайном направлении (seed = id).
    Радиус публичного круга 5 км → реальный адрес гарантированно внутри, но центр круга
    не совпадает с адресом, поэтому по карте нельзя «вычислить» точку."""
    if lat is None or lng is None:
        return (None, None)
    h = hashlib.sha256(f"roofcinema-{rooftop_id}".encode()).digest()
    angle = (h[0] / 255.0) * 2 * math.pi
    dist_km = 1.0 + (h[1] / 255.0) * 1.5
    dlat = (dist_km / 111.0) * math.cos(angle)
    cos_lat = max(0.01, math.cos(math.radians(lat)))
    dlng = (dist_km / (111.0 * cos_lat)) * math.sin(angle)
    return (round(lat + dlat, 4), round(lng + dlng, 4))


def _build_public(db: Session, rooftop: Rooftop, can_see: bool) -> RooftopPublicOut:
    city: City | None = rooftop.city
    lat_f = float(rooftop.lat) if rooftop.lat is not None else None
    lng_f = float(rooftop.lng) if rooftop.lng is not None else None
    approx_lat, approx_lng = _approx_center(lat_f, lng_f, rooftop.id)
    return RooftopPublicOut(
        id=rooftop.id,
        city_id=rooftop.city_id,
        city_name=city.name if city else "",
        city_timezone=city.timezone if city else "Europe/Moscow",
        name=rooftop.name,
        description=rooftop.description,
        cover_url=rooftop.cover_url,
        address=rooftop.address if can_see else None,
        lat=lat_f if can_see else None,
        lng=lng_f if can_see else None,
        approx_lat=approx_lat,
        approx_lng=approx_lng,
        approx_radius_m=3000,
        can_see_address=can_see,
    )


# === публичные ===

@router.get("", response_model=list[RooftopOut])
def list_rooftops(
    city_id: int | None = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
):
    query = db.query(Rooftop)
    if city_id is not None:
        query = query.filter(Rooftop.city_id == city_id)
    if active_only:
        query = query.filter(Rooftop.is_active.is_(True))
    return query.order_by(Rooftop.name).all()


@router.get("/{rooftop_id}", response_model=RooftopPublicOut)
def get_rooftop_public(
    rooftop_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    rooftop = (
        db.query(Rooftop)
        .options(joinedload(Rooftop.city))
        .filter(Rooftop.id == rooftop_id)
        .first()
    )
    if not rooftop:
        raise HTTPException(status_code=404, detail="Крыша не найдена")
    can_see = _user_can_see_address(db, user, rooftop_id)
    return _build_public(db, rooftop, can_see)


# === супер-админ CRUD ===

@router.post("", response_model=RooftopOut, status_code=201, dependencies=[Depends(require_super_admin)])
def create_rooftop(payload: RooftopIn, db: Session = Depends(get_db)):
    if not db.get(City, payload.city_id):
        raise HTTPException(status_code=400, detail="Город не найден")
    rooftop = Rooftop(**payload.model_dump())
    db.add(rooftop)
    db.commit()
    db.refresh(rooftop)
    return rooftop


@router.patch("/{rooftop_id}", response_model=RooftopOut, dependencies=[Depends(require_perm("manage_rooftops"))])
def update_rooftop(rooftop_id: int, payload: RooftopUpdateIn, db: Session = Depends(get_db)):
    rooftop = db.get(Rooftop, rooftop_id)
    if not rooftop:
        raise HTTPException(status_code=404, detail="Крыша не найдена")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(rooftop, k, v)
    db.commit()
    db.refresh(rooftop)
    return rooftop


@router.delete("/{rooftop_id}", status_code=204, dependencies=[Depends(require_super_admin)])
def delete_rooftop(rooftop_id: int, db: Session = Depends(get_db)):
    rooftop = db.get(Rooftop, rooftop_id)
    if not rooftop:
        raise HTTPException(status_code=404, detail="Крыша не найдена")
    db.delete(rooftop)
    db.commit()


# === управление админами крыши ===

@router.post("/{rooftop_id}/invites", response_model=InviteOut, status_code=201)
def create_invite(
    rooftop_id: int,
    payload: InviteCreateIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_super_admin),
):
    rooftop = db.get(Rooftop, rooftop_id)
    if not rooftop:
        raise HTTPException(status_code=404, detail="Крыша не найдена")
    # Нормализуем список прав: убираем дубли и невалидные строки
    perms = None
    if payload and payload.permissions is not None:
        valid = {p.value for p in AdminPermission}
        perms = [p for p in payload.permissions if p in valid]
    invite = RooftopAdminInvite(
        rooftop_id=rooftop_id,
        token=secrets.token_urlsafe(32),
        created_by_id=user.id,
        expires_at=datetime.utcnow() + timedelta(days=7),
        permissions=perms,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


@router.get("/{rooftop_id}/invites", response_model=list[InviteOut], dependencies=[Depends(require_super_admin)])
def list_invites(rooftop_id: int, db: Session = Depends(get_db)):
    return (
        db.query(RooftopAdminInvite)
        .filter(RooftopAdminInvite.rooftop_id == rooftop_id)
        .order_by(RooftopAdminInvite.created_at.desc())
        .all()
    )


@router.post("/{rooftop_id}/invites/{invite_id}/revoke", response_model=InviteOut, dependencies=[Depends(require_super_admin)])
def revoke_invite(rooftop_id: int, invite_id: int, db: Session = Depends(get_db)):
    invite = db.get(RooftopAdminInvite, invite_id)
    if not invite or invite.rooftop_id != rooftop_id:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    invite.revoked_at = datetime.utcnow()
    db.commit()
    db.refresh(invite)
    return invite


@router.post("/invites/{token}/accept", response_model=RooftopOut)
def accept_invite(token: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invite = db.query(RooftopAdminInvite).filter(RooftopAdminInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    if invite.revoked_at:
        raise HTTPException(status_code=400, detail="Приглашение отозвано")
    if invite.accepted_at:
        raise HTTPException(status_code=400, detail="Приглашение уже использовано")
    if invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Срок приглашения истёк")

    existing = (
        db.query(RooftopAdmin)
        .filter(RooftopAdmin.user_id == user.id, RooftopAdmin.rooftop_id == invite.rooftop_id)
        .first()
    )
    # Определяем, для каких крыш создавать RooftopAdmin-связи
    rooftop_ids_to_link = (
        invite.target_rooftop_ids if invite.target_rooftop_ids else [invite.rooftop_id]
    )
    for rid in rooftop_ids_to_link:
        exists = (
            db.query(RooftopAdmin)
            .filter(RooftopAdmin.user_id == user.id, RooftopAdmin.rooftop_id == rid)
            .first()
        )
        if not exists:
            db.add(RooftopAdmin(user_id=user.id, rooftop_id=rid))

    if user.role == UserRole.user.value:
        user.role = UserRole.admin.value
    # Копируем права из приглашения (None → всё разрешено по умолчанию)
    user.permissions = invite.permissions
    invite.accepted_at = datetime.utcnow()
    invite.accepted_by_id = user.id
    db.commit()
    return db.get(Rooftop, invite.rooftop_id)


@router.delete("/{rooftop_id}/admins/{user_id}", status_code=204, dependencies=[Depends(require_super_admin)])
def remove_admin(rooftop_id: int, user_id: int, db: Session = Depends(get_db)):
    link = (
        db.query(RooftopAdmin)
        .filter(RooftopAdmin.user_id == user_id, RooftopAdmin.rooftop_id == rooftop_id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Связь не найдена")
    db.delete(link)
    remaining = db.query(RooftopAdmin).filter(RooftopAdmin.user_id == user_id).count()
    if remaining <= 1:
        target = db.get(User, user_id)
        if target and target.role == UserRole.admin.value:
            target.role = UserRole.user.value
    db.commit()
