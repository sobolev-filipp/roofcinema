from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import require_admin_or_super, require_perm
from ..models import Movie, MovieStill
from ..schemas import MovieIn, MovieOut, MovieStillIn, MovieStillOut, MovieUpdateIn

router = APIRouter(prefix="/api/movies", tags=["movies"])


@router.get("", response_model=list[MovieOut])
def list_movies(q: str | None = None, limit: int = 50, db: Session = Depends(get_db)):
    # selectinload — отдельный запрос для stills, не дублирует строки и работает с LIMIT.
    query = db.query(Movie).options(selectinload(Movie.stills))
    if q:
        like = f"%{q}%"
        query = query.filter((Movie.title.ilike(like)) | (Movie.original_title.ilike(like)))
    return query.order_by(Movie.title).limit(min(limit, 200)).all()


@router.get("/{movie_id}", response_model=MovieOut)
def get_movie(movie_id: int, db: Session = Depends(get_db)):
    movie = (
        db.query(Movie)
        .options(selectinload(Movie.stills))
        .filter(Movie.id == movie_id)
        .first()
    )
    if not movie:
        raise HTTPException(status_code=404, detail="Фильм не найден")
    return movie


@router.post("", response_model=MovieOut, status_code=201, dependencies=[Depends(require_perm("manage_movies"))])
def create_movie(payload: MovieIn, db: Session = Depends(get_db)):
    if payload.kinopoisk_id:
        existing = db.query(Movie).filter(Movie.kinopoisk_id == payload.kinopoisk_id).first()
        if existing:
            return existing
    movie = Movie(**payload.model_dump())
    db.add(movie)
    db.commit()
    db.refresh(movie)
    return movie


@router.patch("/{movie_id}", response_model=MovieOut, dependencies=[Depends(require_perm("manage_movies"))])
def update_movie(movie_id: int, payload: MovieUpdateIn, db: Session = Depends(get_db)):
    movie = db.get(Movie, movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail="Фильм не найден")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(movie, k, v)
    db.commit()
    db.refresh(movie)
    return movie


@router.delete("/{movie_id}", status_code=204, dependencies=[Depends(require_perm("manage_movies"))])
def delete_movie(movie_id: int, db: Session = Depends(get_db)):
    movie = db.get(Movie, movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail="Фильм не найден")
    db.delete(movie)
    db.commit()


# --- кадры из фильма ---

@router.post("/{movie_id}/stills", response_model=MovieStillOut, status_code=201, dependencies=[Depends(require_perm("manage_movies"))])
def add_still(movie_id: int, payload: MovieStillIn, db: Session = Depends(get_db)):
    if not db.get(Movie, movie_id):
        raise HTTPException(status_code=404, detail="Фильм не найден")
    still = MovieStill(movie_id=movie_id, image_url=payload.image_url, position=payload.position)
    db.add(still)
    db.commit()
    db.refresh(still)
    return still


@router.delete("/{movie_id}/stills/{still_id}", status_code=204, dependencies=[Depends(require_perm("manage_movies"))])
def remove_still(movie_id: int, still_id: int, db: Session = Depends(get_db)):
    still = db.get(MovieStill, still_id)
    if not still or still.movie_id != movie_id:
        raise HTTPException(status_code=404, detail="Кадр не найден")
    db.delete(still)
    db.commit()
