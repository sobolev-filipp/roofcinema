from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from datetime import datetime

from .db import get_db
from .models import User, UserRole, RooftopAdmin, UserSession
from .security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def _user_from_token(token: str, db: Session) -> User | None:
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
        jti = payload.get("jti")
    except (JWTError, ValueError, TypeError):
        return None
    user = db.get(User, user_id)
    if not user or not user.is_active:
        return None
    # Если в токене есть jti — проверим что сессия не отозвана
    if jti:
        session = db.query(UserSession).filter(UserSession.jti == jti).first()
        if not session or session.revoked_at is not None:
            return None
        # обновляем last_seen раз в минуту чтобы не дёргать БД на каждый запрос
        now = datetime.utcnow()
        if (now - session.last_seen_at).total_seconds() > 60:
            session.last_seen_at = now
            db.commit()
    return user


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Не авторизован")
    user = _user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")
    return user


def get_current_user_optional(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    if not token:
        return None
    return _user_from_token(token, db)


def get_current_jti(token: str | None = Depends(oauth2_scheme)) -> str | None:
    """Возвращает jti текущей сессии (для logout/list)."""
    if not token:
        return None
    try:
        payload = decode_token(token)
        return payload.get("jti")
    except (JWTError, ValueError, TypeError):
        return None


def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.super_admin.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только владелец может выполнить это действие")
    return user


def require_admin_or_super(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.super_admin.value, UserRole.admin.value):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступно только администраторам")
    return user


def require_perm(perm: str):
    """Factory: возвращает Depends, проверяющий наличие гранулярного права у администратора.

    Правила:
    - super_admin → всегда проходит.
    - admin с permissions=None → «старый» аккаунт, имеет все права (обратная совместимость).
    - admin с конкретным списком → проверяем наличие perm в списке.
    - user → 403 (require_admin_or_super отработает раньше).
    """
    def _dep(user: User = Depends(require_admin_or_super)) -> User:
        if user.role == UserRole.super_admin.value:
            return user
        if user.permissions is None:
            return user
        if perm not in (user.permissions or []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"У вас нет права: {perm}",
            )
        return user
    return _dep


def require_any_perm(*perms: str):
    """Как require_perm, но достаточно ЛЮБОГО из перечисленных прав.
    Полезно для разделов, доступных по нескольким смежным правам (напр. «Клиенты»
    — manage_customers ИЛИ исторически manage_bookings)."""
    def _dep(user: User = Depends(require_admin_or_super)) -> User:
        if user.role == UserRole.super_admin.value:
            return user
        if user.permissions is None:
            return user
        have = set(user.permissions or [])
        if not have.intersection(perms):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"У вас нет ни одного из прав: {', '.join(perms)}",
            )
        return user
    return _dep


def require_rooftop_access(
    rooftop_id: int,
    permission: str = "can_manage_movies",
):
    """Factory: возвращает Depends, проверяющий что user — super_admin
    или у него есть RooftopAdmin с нужным флагом для этой крыши."""
    def _dep(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        if user.role == UserRole.super_admin.value:
            return user
        link = (
            db.query(RooftopAdmin)
            .filter(RooftopAdmin.user_id == user.id, RooftopAdmin.rooftop_id == rooftop_id)
            .first()
        )
        if not link or not getattr(link, permission, False):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет прав на эту крышу")
        return user
    return _dep
