from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_super_admin
from ..models import City, Rooftop, Screening
from ..schemas import CityIn, CityOut, CityUpdateIn
from ..utils import RU_TIMEZONES, RU_TZ_VALUES, slugify

router = APIRouter(prefix="/api/cities", tags=["cities"])


@router.get("/timezones")
def list_timezones():
    """Список российских часовых поясов для UI-селектора."""
    return RU_TIMEZONES


@router.get("", response_model=list[CityOut])
def list_cities(active_only: bool = True, q: str | None = None, db: Session = Depends(get_db)):
    query = db.query(City)
    if active_only:
        query = query.filter(City.is_active.is_(True))
    if q:
        query = query.filter(City.name.ilike(f"%{q}%"))
    return query.order_by(City.name).all()


def _ensure_unique_slug(db: Session, base: str, ignore_id: int | None = None) -> str:
    slug = base
    n = 2
    while True:
        q = db.query(City).filter(City.slug == slug)
        if ignore_id is not None:
            q = q.filter(City.id != ignore_id)
        if not q.first():
            return slug
        slug = f"{base}-{n}"
        n += 1


@router.post("", response_model=CityOut, status_code=201, dependencies=[Depends(require_super_admin)])
def create_city(payload: CityIn, db: Session = Depends(get_db)):
    if db.query(City).filter(City.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Город с таким названием уже существует")
    if payload.timezone not in RU_TZ_VALUES:
        raise HTTPException(status_code=400, detail="Недопустимый часовой пояс")
    slug = payload.slug or slugify(payload.name)
    slug = _ensure_unique_slug(db, slug)
    city = City(name=payload.name, slug=slug, timezone=payload.timezone)
    db.add(city)
    db.commit()
    db.refresh(city)
    return city


@router.patch("/{city_id}", response_model=CityOut, dependencies=[Depends(require_super_admin)])
def update_city(city_id: int, payload: CityUpdateIn, db: Session = Depends(get_db)):
    city = db.get(City, city_id)
    if not city:
        raise HTTPException(status_code=404, detail="Город не найден")
    data = payload.model_dump(exclude_unset=True)
    if "timezone" in data and data["timezone"] not in RU_TZ_VALUES:
        raise HTTPException(status_code=400, detail="Недопустимый часовой пояс")
    if "slug" in data and data["slug"]:
        data["slug"] = _ensure_unique_slug(db, data["slug"], ignore_id=city.id)
    for k, v in data.items():
        setattr(city, k, v)
    db.commit()
    db.refresh(city)
    return city


@router.get("/{city_id}/dependents", dependencies=[Depends(require_super_admin)])
def city_dependents(city_id: int, db: Session = Depends(get_db)):
    """Сколько крыш и показов привязано к городу — для предупреждения перед удалением."""
    city = db.get(City, city_id)
    if not city:
        raise HTTPException(status_code=404, detail="Город не найден")
    rooftops = db.query(Rooftop).filter(Rooftop.city_id == city_id).count()
    screenings = (
        db.query(Screening)
        .join(Rooftop, Screening.rooftop_id == Rooftop.id)
        .filter(Rooftop.city_id == city_id)
        .count()
    )
    return {"rooftops": rooftops, "screenings": screenings}


@router.delete("/{city_id}", status_code=204, dependencies=[Depends(require_super_admin)])
def delete_city(city_id: int, force: bool = False, db: Session = Depends(get_db)):
    """Удаляет город. Без force запрещает удаление, если есть привязанные крыши или показы."""
    city = db.get(City, city_id)
    if not city:
        raise HTTPException(status_code=404, detail="Город не найден")
    rooftops = db.query(Rooftop).filter(Rooftop.city_id == city_id).count()
    screenings = (
        db.query(Screening)
        .join(Rooftop, Screening.rooftop_id == Rooftop.id)
        .filter(Rooftop.city_id == city_id)
        .count()
    )
    if (rooftops or screenings) and not force:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Нельзя удалить: к городу привязано "
                f"{rooftops} крыш(а) и {screenings} показ(ов). "
                "Удалите их сначала или передайте ?force=true."
            ),
        )
    db.delete(city)
    db.commit()
