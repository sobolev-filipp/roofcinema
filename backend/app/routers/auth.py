import random
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_jti, get_current_user
from ..email_service import send_login_code, send_password_reset, send_verification_code
from ..models import EmailVerification, LoginCode, PasswordResetToken, User, UserRole, UserSession
from ..schemas import LoginChallengeOut, LoginIn, LoginResendIn, LoginVerifyIn, RegisterIn, TokenOut, UserOut
from ..security import create_access_token, hash_password, new_jti, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _create_session(db: Session, user: User, request: Request | None) -> str:
    """Создаёт UserSession + JWT с jti. Возвращает токен."""
    jti = new_jti()
    ua = request.headers.get("user-agent") if request else None
    ip = request.client.host if request and request.client else None
    sess = UserSession(user_id=user.id, jti=jti, user_agent=(ua or "")[:512], ip=ip)
    db.add(sess)
    db.commit()
    return create_access_token(user.id, jti=jti, extra={"role": user.role})


def _send_new_verification(db: Session, user: User) -> None:
    """Удаляет старые коды юзера, генерирует новый, отправляет."""
    db.query(EmailVerification).filter(EmailVerification.user_id == user.id).delete()
    code = _generate_code()
    ev = EmailVerification(
        user_id=user.id,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=10),
        last_sent_at=datetime.utcnow(),
    )
    db.add(ev)
    db.commit()
    send_verification_code(user.email, code)


@router.post("/register", response_model=TokenOut, status_code=201)
def register(payload: RegisterIn, request: Request, db: Session = Depends(get_db)):
    if not payload.pd_consent:
        raise HTTPException(status_code=400, detail="Требуется согласие на обработку персональных данных")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже зарегистрирован")
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=UserRole.user.value,
        home_city_id=payload.home_city_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _send_new_verification(db, user)
    token = _create_session(db, user, request)
    return TokenOut(access_token=token)


def _create_login_challenge(db: Session, user: User) -> LoginChallengeOut:
    """Генерирует OTP-код, сохраняет в login_codes, отправляет на email."""
    # Удаляем старые коды этого пользователя
    db.query(LoginCode).filter(LoginCode.user_id == user.id).delete()
    code = _generate_code()
    mfa_token = secrets.token_urlsafe(32)
    lc = LoginCode(
        mfa_token=mfa_token,
        user_id=user.id,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=5),
        last_sent_at=datetime.utcnow(),
    )
    db.add(lc)
    db.commit()
    send_login_code(user.email, code)
    return LoginChallengeOut(mfa_token=mfa_token, expires_in=300)


@router.post("/login", response_model=LoginChallengeOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт деактивирован")
    return _create_login_challenge(db, user)


@router.post("/login-json", response_model=LoginChallengeOut)
def login_json(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт деактивирован")
    return _create_login_challenge(db, user)


@router.post("/login-verify", response_model=TokenOut)
def login_verify(payload: LoginVerifyIn, request: Request, db: Session = Depends(get_db)):
    """Второй шаг входа: проверяет OTP-код и выдаёт JWT."""
    lc = db.query(LoginCode).filter(LoginCode.mfa_token == payload.mfa_token).first()
    if not lc:
        raise HTTPException(status_code=400, detail="Код устарел или недействителен. Войдите заново.")
    if lc.expires_at < datetime.utcnow():
        db.delete(lc)
        db.commit()
        raise HTTPException(status_code=400, detail="Срок действия кода истёк. Войдите заново.")
    if lc.attempts >= 5:
        db.delete(lc)
        db.commit()
        raise HTTPException(status_code=429, detail="Превышено число попыток. Войдите заново.")
    lc.attempts += 1
    if payload.code.strip() != lc.code:
        db.commit()
        left = 5 - lc.attempts
        raise HTTPException(status_code=400, detail=f"Неверный код. Попыток осталось: {left}.")
    user = db.get(User, lc.user_id)
    if not user or not user.is_active:
        db.delete(lc)
        db.commit()
        raise HTTPException(status_code=403, detail="Аккаунт деактивирован")
    db.delete(lc)
    db.commit()
    return TokenOut(access_token=_create_session(db, user, request))


@router.post("/login-resend", response_model=LoginChallengeOut)
def login_resend(payload: LoginResendIn, db: Session = Depends(get_db)):
    """Повторная отправка кода (не чаще раза в 60 секунд)."""
    lc = db.query(LoginCode).filter(LoginCode.mfa_token == payload.mfa_token).first()
    if not lc:
        raise HTTPException(status_code=400, detail="Сессия входа не найдена. Начните заново.")
    if lc.expires_at < datetime.utcnow():
        db.delete(lc)
        db.commit()
        raise HTTPException(status_code=400, detail="Код истёк. Войдите заново.")
    wait = 60 - (datetime.utcnow() - lc.last_sent_at).total_seconds()
    if wait > 0:
        raise HTTPException(status_code=429, detail=f"Подождите ещё {int(wait)} секунд")
    user = db.get(User, lc.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=403, detail="Аккаунт деактивирован")
    # Обновляем код и время
    new_code = _generate_code()
    lc.code = new_code
    lc.attempts = 0
    lc.expires_at = datetime.utcnow() + timedelta(minutes=5)
    lc.last_sent_at = datetime.utcnow()
    db.commit()
    send_login_code(user.email, new_code)
    return LoginChallengeOut(mfa_token=lc.mfa_token, expires_in=300)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/logout", status_code=204)
def logout(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    jti: str | None = Depends(get_current_jti),
):
    if jti:
        sess = db.query(UserSession).filter(UserSession.user_id == user.id, UserSession.jti == jti).first()
        if sess and not sess.revoked_at:
            sess.revoked_at = datetime.utcnow()
            db.commit()


# === EMAIL VERIFICATION ===

class VerifyCodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=8)


@router.post("/verify-email/send")
def verify_email_send(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Отправить (или переотправить) код подтверждения. Между отправками минимум 60с."""
    if user.is_email_verified:
        raise HTTPException(status_code=400, detail="Email уже подтверждён")
    last = (
        db.query(EmailVerification)
        .filter(EmailVerification.user_id == user.id)
        .order_by(EmailVerification.id.desc())
        .first()
    )
    if last:
        wait = 60 - (datetime.utcnow() - last.last_sent_at).total_seconds()
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"Подождите ещё {int(wait)} секунд")
    _send_new_verification(db, user)
    return {"sent": True, "next_resend_after_seconds": 60}


@router.get("/verify-email/status")
def verify_email_status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Статус подтверждения + сколько секунд до возможности переотправить код."""
    if user.is_email_verified:
        return {"verified": True, "can_resend_in": 0}
    last = (
        db.query(EmailVerification)
        .filter(EmailVerification.user_id == user.id)
        .order_by(EmailVerification.id.desc())
        .first()
    )
    wait = 0
    if last:
        wait = max(0, int(60 - (datetime.utcnow() - last.last_sent_at).total_seconds()))
    return {"verified": False, "can_resend_in": wait}


@router.post("/verify-email/confirm")
def verify_email_confirm(
    payload: VerifyCodeIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.is_email_verified:
        return {"verified": True}
    ev = (
        db.query(EmailVerification)
        .filter(EmailVerification.user_id == user.id)
        .order_by(EmailVerification.id.desc())
        .first()
    )
    if not ev:
        raise HTTPException(status_code=400, detail="Код не запрашивался")
    if ev.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Срок действия кода истёк, запросите новый")
    if ev.attempts >= 6:
        raise HTTPException(status_code=429, detail="Превышено число попыток. Запросите новый код.")
    ev.attempts += 1
    if payload.code.strip() != ev.code:
        db.commit()
        raise HTTPException(status_code=400, detail="Неверный код")
    user.is_email_verified = True
    user.email_verified_at = datetime.utcnow()
    db.query(EmailVerification).filter(EmailVerification.user_id == user.id).delete()
    db.commit()
    return {"verified": True}


# === PASSWORD RESET ===

class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


@router.post("/forgot-password", status_code=204)
def forgot_password(payload: ForgotPasswordIn, db: Session = Depends(get_db)):
    """Отправляет ссылку для сброса. Всегда возвращает 204, даже если email не найден
    — чтобы не подсказывать злоумышленнику какие email есть в базе."""
    user = db.query(User).filter(User.email == payload.email).first()
    if user:
        token = secrets.token_urlsafe(32)
        db.add(PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=datetime.utcnow() + timedelta(hours=1),
        ))
        db.commit()
        from ..config import get_settings
        base = get_settings().APP_BASE_URL.rstrip("/")
        send_password_reset(user.email, f"{base}/reset-password?token={token}")


@router.post("/reset-password", status_code=204)
def reset_password(payload: ResetPasswordIn, db: Session = Depends(get_db)):
    prt = db.query(PasswordResetToken).filter(PasswordResetToken.token == payload.token).first()
    if not prt or prt.used_at or prt.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Ссылка недействительна или истекла")
    user = db.get(User, prt.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Пользователь не найден")
    user.password_hash = hash_password(payload.new_password)
    prt.used_at = datetime.utcnow()
    # инвалидируем все активные сессии — пусть переавторизуется
    db.query(UserSession).filter(
        UserSession.user_id == user.id, UserSession.revoked_at.is_(None)
    ).update({UserSession.revoked_at: datetime.utcnow()})
    db.commit()
