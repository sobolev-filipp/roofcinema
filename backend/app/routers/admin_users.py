"""Управление администраторами: список, редактирование прав, отзыв, создание глобальных инвайтов."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import require_perm, require_super_admin
from ..models import (
    AdminPermission,
    City,
    Rooftop,
    RooftopAdmin,
    RooftopAdminInvite,
    User,
    UserRole,
)
from ..schemas import (
    AdminPermissionsUpdateIn,
    AdminRooftopLink,
    AdminUserOut,
    InviteCreateIn,
    InviteOut,
)

router = APIRouter(prefix="/api/admin", tags=["admin-users"])

_VALID_PERMS = {p.value for p in AdminPermission}


def _admin_to_out(user: User, db: Session) -> AdminUserOut:
    links = (
        db.query(RooftopAdmin)
        .options(joinedload(RooftopAdmin.rooftop).joinedload(Rooftop.city))
        .filter(RooftopAdmin.user_id == user.id)
        .all()
    )
    rooftops = [
        AdminRooftopLink(
            rooftop_id=lnk.rooftop_id,
            rooftop_name=lnk.rooftop.name if lnk.rooftop else "—",
            city_id=lnk.rooftop.city_id if lnk.rooftop else 0,
            city_name=lnk.rooftop.city.name if (lnk.rooftop and lnk.rooftop.city) else "—",
        )
        for lnk in links
    ]
    return AdminUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        permissions=user.permissions,
        rooftops=rooftops,
        created_at=user.created_at,
    )


# ── Список администраторов ──────────────────────────────────────────────────

@router.get("/admins", response_model=list[AdminUserOut])
def list_admins(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_perm("manage_admins")),
):
    """Все пользователи с ролью admin (кроме super_admin)."""
    users = (
        db.query(User)
        .filter(User.role == UserRole.admin.value, User.is_active.is_(True))
        .order_by(User.created_at.desc())
        .all()
    )
    return [_admin_to_out(u, db) for u in users]


# ── Редактирование прав ────────────────────────────────────────────────────

@router.patch("/admins/{user_id}/permissions", response_model=AdminUserOut)
def update_admin_permissions(
    user_id: int,
    payload: AdminPermissionsUpdateIn,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_perm("manage_admins")),
):
    """Обновить permissions у администратора. null = все права; [] = без прав."""
    user = db.get(User, user_id)
    if not user or user.role != UserRole.admin.value:
        raise HTTPException(status_code=404, detail="Администратор не найден")
    # Нормализуем — убираем неизвестные права
    if payload.permissions is not None:
        user.permissions = [p for p in payload.permissions if p in _VALID_PERMS]
    else:
        user.permissions = None
    db.commit()
    db.refresh(user)
    return _admin_to_out(user, db)


# ── Отзыв admin-статуса ────────────────────────────────────────────────────

@router.delete("/admins/{user_id}", status_code=204)
def revoke_admin(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    """Отозвать права администратора (понизить до user). Только super_admin."""
    user = db.get(User, user_id)
    if not user or user.role != UserRole.admin.value:
        raise HTTPException(status_code=404, detail="Администратор не найден")
    user.role = UserRole.user.value
    user.permissions = None
    # Удаляем все RooftopAdmin-связи
    db.query(RooftopAdmin).filter(RooftopAdmin.user_id == user_id).delete()
    db.commit()


# ── Создание глобального инвайта (с несколькими крышами) ───────────────────

@router.post("/invites", response_model=InviteOut, status_code=201)
def create_global_invite(
    payload: InviteCreateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin),
):
    """Создать приглашение для нескольких крыш сразу.
    payload.rooftop_ids должен содержать хотя бы одну крышу."""
    if not payload.rooftop_ids:
        raise HTTPException(status_code=400, detail="Необходимо выбрать хотя бы одну крышу")

    # Проверяем что все крыши существуют
    rooftops = db.query(Rooftop).filter(Rooftop.id.in_(payload.rooftop_ids)).all()
    found_ids = {r.id for r in rooftops}
    missing = [rid for rid in payload.rooftop_ids if rid not in found_ids]
    if missing:
        raise HTTPException(status_code=400, detail=f"Крыши не найдены: {missing}")

    # Нормализуем права
    perms = None
    if payload.permissions is not None:
        perms = [p for p in payload.permissions if p in _VALID_PERMS]

    # rooftop_id = первый выбранный (для FK NOT NULL)
    primary_rooftop_id = payload.rooftop_ids[0]
    # target_rooftop_ids = полный список (при принятии — создадутся ссылки для всех)
    target_ids = list(dict.fromkeys(payload.rooftop_ids))  # уникальные, сохраняем порядок

    invite = RooftopAdminInvite(
        rooftop_id=primary_rooftop_id,
        token=secrets.token_urlsafe(32),
        created_by_id=_.id,
        expires_at=datetime.utcnow() + timedelta(days=7),
        permissions=perms,
        target_rooftop_ids=target_ids,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


# ── Список глобальных инвайтов ─────────────────────────────────────────────

@router.get("/invites", response_model=list[InviteOut])
def list_global_invites(
    db: Session = Depends(get_db),
    _: User = Depends(require_perm("manage_admins")),
):
    """Все инвайты (из всех крыш), отсортированные по дате создания."""
    return (
        db.query(RooftopAdminInvite)
        .order_by(RooftopAdminInvite.created_at.desc())
        .limit(200)
        .all()
    )
