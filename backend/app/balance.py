"""Работа с балансом, привязанным к email (таблица EmailBalance).

Единая точка чтения/пополнения/списания. Email везде нормализуется (trim + lower),
чтобы 'User@Mail.ru' и 'user@mail.ru' считались одним кошельком.
Функции делают flush, но НЕ commit — коммитит вызывающий код в своей транзакции.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from .models import EmailBalance, User
from .schemas import UserOut


def norm_email(email: str | None) -> str:
    return (email or "").strip().lower()


def get_balance(db: Session, email: str | None) -> float:
    e = norm_email(email)
    if not e:
        return 0.0
    row = db.query(EmailBalance).filter(EmailBalance.email == e).first()
    return float(row.amount) if row else 0.0


def _row_for(db: Session, email: str) -> EmailBalance:
    row = db.query(EmailBalance).filter(EmailBalance.email == email).first()
    if row is None:
        row = EmailBalance(email=email, amount=0)
        db.add(row)
    return row


def credit_balance(db: Session, email: str | None, amount: float) -> float:
    """Пополнить баланс email на amount. Возвращает новый баланс."""
    e = norm_email(email)
    if not e or amount == 0:
        return get_balance(db, email)
    row = _row_for(db, e)
    row.amount = float(row.amount or 0) + float(amount)
    row.updated_at = datetime.utcnow()
    db.flush()
    return float(row.amount)


def debit_balance(db: Session, email: str | None, amount: float) -> float:
    """Списать amount с баланса email. Бросает ValueError, если средств не хватает."""
    e = norm_email(email)
    current = get_balance(db, e)
    if amount > current + 1e-9:
        raise ValueError(f"Недостаточно средств на балансе: есть {current:.2f}, нужно {amount:.2f}")
    row = _row_for(db, e)
    row.amount = current - float(amount)
    row.updated_at = datetime.utcnow()
    db.flush()
    return float(row.amount)


def serialize_user(db: Session, user: User) -> UserOut:
    """UserOut с балансом, подтянутым по email пользователя (а не из User.balance)."""
    out = UserOut.model_validate(user, from_attributes=True)
    out.balance = get_balance(db, user.email)
    return out
