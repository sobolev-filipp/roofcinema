from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy.orm import Session

from ..balance import serialize_user
from ..db import get_db
from ..deps import get_current_jti, get_current_user
from ..email_service import send_verification_code
from ..models import EmailVerification, User, UserSession
from ..schemas import UserOut, UserUpdateIn
from ..security import hash_password, verify_password

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return serialize_user(db, user)


@router.patch("/me", response_model=UserOut)
def update_me(payload: UserUpdateIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return serialize_user(db, user)


# === INITIAL SETUP: смена email + пароля для дефолтного владельца ===

class InitialSetupIn(BaseModel):
    new_email: EmailStr
    new_password: str = Field(min_length=6, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


@router.post("/me/initial-setup", response_model=UserOut)
def initial_setup(
    payload: InitialSetupIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Меняет email и пароль владельца с дефолтных значений на настоящие.
    Доступно только пока установлен requires_initial_setup."""
    if not user.requires_initial_setup:
        raise HTTPException(status_code=400, detail="Первичная настройка уже завершена")
    # email уникален
    if payload.new_email.lower() != user.email.lower():
        exists = db.query(User).filter(User.email == payload.new_email).first()
        if exists and exists.id != user.id:
            raise HTTPException(status_code=400, detail="Этот email уже занят другим пользователем")
    user.email = payload.new_email
    user.password_hash = hash_password(payload.new_password)
    if payload.full_name:
        user.full_name = payload.full_name
    user.requires_initial_setup = False
    user.is_email_verified = False
    user.email_verified_at = None
    db.commit()
    db.refresh(user)
    # отправляем код подтверждения на новый email
    db.query(EmailVerification).filter(EmailVerification.user_id == user.id).delete()
    import random
    from datetime import datetime, timedelta
    code = f"{random.randint(0, 999999):06d}"
    db.add(EmailVerification(
        user_id=user.id, code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
        last_sent_at=datetime.utcnow(),
    ))
    db.commit()
    send_verification_code(user.email, code)
    return serialize_user(db, user)


# === SECURITY: смена пароля + список сессий + revoke ===

class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


@router.post("/me/change-password", status_code=204)
def change_password(
    payload: ChangePasswordIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    jti: str | None = Depends(get_current_jti),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")
    user.password_hash = hash_password(payload.new_password)
    # отзываем все другие сессии — только текущая остаётся живой
    if jti:
        db.query(UserSession).filter(
            UserSession.user_id == user.id,
            UserSession.revoked_at.is_(None),
            UserSession.jti != jti,
        ).update({UserSession.revoked_at: datetime.utcnow()})
    db.commit()


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_agent: str | None
    ip: str | None
    created_at: datetime
    last_seen_at: datetime
    is_current: bool = False


@router.get("/me/sessions", response_model=list[SessionOut])
def list_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    jti: str | None = Depends(get_current_jti),
):
    rows = (
        db.query(UserSession)
        .filter(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        .order_by(UserSession.last_seen_at.desc())
        .all()
    )
    out: list[SessionOut] = []
    for s in rows:
        item = SessionOut.model_validate(s, from_attributes=True)
        item.is_current = (jti is not None and s.jti == jti)
        out.append(item)
    return out


@router.post("/me/sessions/{session_id}/revoke", status_code=204)
def revoke_session(
    session_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = db.get(UserSession, session_id)
    if not s or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if s.revoked_at is None:
        s.revoked_at = datetime.utcnow()
        db.commit()


@router.post("/me/sessions/revoke-all-except-current", status_code=204)
def revoke_others(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    jti: str | None = Depends(get_current_jti),
):
    q = db.query(UserSession).filter(
        UserSession.user_id == user.id, UserSession.revoked_at.is_(None)
    )
    if jti:
        q = q.filter(UserSession.jti != jti)
    q.update({UserSession.revoked_at: datetime.utcnow()})
    db.commit()
