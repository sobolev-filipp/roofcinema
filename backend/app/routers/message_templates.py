"""CRUD шаблонов сообщений + утилита предпросмотра.
Используются на следующих этапах (D — ручное бронирование, E — возврат средств, F — отмена показа)."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin_or_super, require_perm
from ..models import MessageTemplate
from ..schemas import (
    ALLOWED_TEMPLATE_KINDS,
    MessageTemplateIn,
    MessageTemplateOut,
    MessageTemplateUpdateIn,
    RenderRequest,
    RenderResponse,
)
from ..utils import TEMPLATE_PLACEHOLDERS, render_template

router = APIRouter(prefix="/api/admin/message-templates", tags=["message-templates"])


def _ensure_kind(kind: str) -> None:
    if kind not in ALLOWED_TEMPLATE_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"Неизвестный тип шаблона. Допустимые: {', '.join(ALLOWED_TEMPLATE_KINDS)}",
        )


def _unset_other_defaults(db: Session, kind: str, except_id: int | None) -> None:
    q = db.query(MessageTemplate).filter(
        MessageTemplate.kind == kind, MessageTemplate.is_default.is_(True)
    )
    if except_id is not None:
        q = q.filter(MessageTemplate.id != except_id)
    for t in q.all():
        t.is_default = False


@router.get("/placeholders", dependencies=[Depends(require_admin_or_super)])
def list_placeholders():
    """Какие плейсхолдеры доступны в шаблоне каждого kind. Frontend показывает их кликабельными бейджами."""
    return TEMPLATE_PLACEHOLDERS


@router.get("", response_model=list[MessageTemplateOut], dependencies=[Depends(require_admin_or_super)])
def list_templates(kind: str | None = None, db: Session = Depends(get_db)):
    q = db.query(MessageTemplate)
    if kind:
        _ensure_kind(kind)
        q = q.filter(MessageTemplate.kind == kind)
    return q.order_by(MessageTemplate.kind, MessageTemplate.is_default.desc(), MessageTemplate.id).all()


@router.post("", response_model=MessageTemplateOut, status_code=201, dependencies=[Depends(require_perm("manage_templates"))])
def create_template(payload: MessageTemplateIn, db: Session = Depends(get_db)):
    _ensure_kind(payload.kind)
    t = MessageTemplate(
        kind=payload.kind,
        name=payload.name.strip(),
        text=payload.text,
        is_default=bool(payload.is_default),
    )
    db.add(t)
    db.flush()
    if t.is_default:
        _unset_other_defaults(db, t.kind, except_id=t.id)
    db.commit()
    db.refresh(t)
    return t


@router.patch("/{template_id}", response_model=MessageTemplateOut, dependencies=[Depends(require_perm("manage_templates"))])
def update_template(template_id: int, payload: MessageTemplateUpdateIn, db: Session = Depends(get_db)):
    t = db.get(MessageTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        t.name = data["name"].strip()
    if "text" in data and data["text"] is not None:
        t.text = data["text"]
    if "is_default" in data and data["is_default"] is not None:
        t.is_default = bool(data["is_default"])
        if t.is_default:
            _unset_other_defaults(db, t.kind, except_id=t.id)
    t.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{template_id}", status_code=204, dependencies=[Depends(require_perm("manage_templates"))])
def delete_template(template_id: int, db: Session = Depends(get_db)):
    t = db.get(MessageTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    db.delete(t)
    db.commit()


@router.post(
    "/{template_id}/set-default",
    response_model=MessageTemplateOut,
    dependencies=[Depends(require_perm("manage_templates"))],
)
def set_default(template_id: int, db: Session = Depends(get_db)):
    t = db.get(MessageTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    t.is_default = True
    _unset_other_defaults(db, t.kind, except_id=t.id)
    t.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    return t


@router.post("/preview", response_model=RenderResponse, dependencies=[Depends(require_admin_or_super)])
def preview_template(payload: RenderRequest):
    """Предпросмотр: подставляет переданный context в text. Удобно показать
    админу как будет выглядеть письмо при заполненных переменных."""
    return RenderResponse(rendered=render_template(payload.text, payload.context))
