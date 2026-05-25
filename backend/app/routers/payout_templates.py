"""Шаблоны реквизитов для оплаты переводом."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin_or_super, require_super_admin
from ..models import PayoutTemplate
from ..schemas import PayoutTemplateIn, PayoutTemplateOut

router = APIRouter(prefix="/api/payout-templates", tags=["payout-templates"])


@router.get("", response_model=list[PayoutTemplateOut])
def list_templates(db: Session = Depends(get_db), _admin=Depends(require_admin_or_super)):
    return db.query(PayoutTemplate).order_by(PayoutTemplate.is_default.desc(), PayoutTemplate.name).all()


@router.post("", response_model=PayoutTemplateOut, status_code=201, dependencies=[Depends(require_super_admin)])
def create_template(payload: PayoutTemplateIn, db: Session = Depends(get_db)):
    if payload.is_default:
        # снимаем флаг с других
        db.query(PayoutTemplate).update({PayoutTemplate.is_default: False})
    t = PayoutTemplate(**payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.patch("/{template_id}", response_model=PayoutTemplateOut, dependencies=[Depends(require_super_admin)])
def update_template(template_id: int, payload: PayoutTemplateIn, db: Session = Depends(get_db)):
    t = db.get(PayoutTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    if payload.is_default and not t.is_default:
        db.query(PayoutTemplate).update({PayoutTemplate.is_default: False})
    for k, v in payload.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{template_id}", status_code=204, dependencies=[Depends(require_super_admin)])
def delete_template(template_id: int, db: Session = Depends(get_db)):
    t = db.get(PayoutTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    db.delete(t)
    db.commit()
