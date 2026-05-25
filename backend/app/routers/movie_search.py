"""Поиск фильмов во внешних источниках (OMDb / Кинопоиск)
+ локальный поиск по уже добавленным фильмам.

Если API-ключи не настроены — фронт получит {configured: false}
и предложит «заполнить вручную»."""
from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import require_admin_or_super
from ..models import Movie

router = APIRouter(prefix="/api/movies", tags=["movie-search"])

OMDB_URL = "https://www.omdbapi.com/"
KP_URL = "https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword"
KP_FILM_URL = "https://kinopoiskapiunofficial.tech/api/v2.2/films"
UA = "RoofCinema/0.1"
TTL_SEC = 600
_cache: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str):
    item = _cache.get(key)
    if item and time.time() - item[0] < TTL_SEC:
        return item[1]
    return None


def _cache_put(key: str, val: Any) -> None:
    _cache[key] = (time.time(), val)


def _search_omdb(q: str, api_key: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=8.0, headers={"User-Agent": UA}) as cli:
            r = cli.get(OMDB_URL, params={"apikey": api_key, "s": q, "type": "movie"})
            data = r.json()
            for it in (data.get("Search") or []):
                imdb_id = it.get("imdbID")
                # запрашиваем детали для рейтинга и описания
                d_resp = cli.get(OMDB_URL, params={"apikey": api_key, "i": imdb_id, "plot": "short"})
                d = d_resp.json()
                try:
                    rating = float(d.get("imdbRating")) if d.get("imdbRating") and d["imdbRating"] != "N/A" else None
                except ValueError:
                    rating = None
                try:
                    runtime = int(str(d.get("Runtime", "")).split()[0]) if d.get("Runtime") and d["Runtime"] != "N/A" else None
                except (ValueError, IndexError):
                    runtime = None
                out.append({
                    "source": "omdb",
                    "external_id": imdb_id,
                    "title": d.get("Title") or it.get("Title"),
                    "original_title": d.get("Title") or it.get("Title"),
                    "year": int(it.get("Year", "0")[:4]) if it.get("Year", "")[:4].isdigit() else None,
                    "poster_url": (it.get("Poster") if it.get("Poster") and it.get("Poster") != "N/A" else None),
                    "description": d.get("Plot") if d.get("Plot") and d.get("Plot") != "N/A" else None,
                    "director": d.get("Director") if d.get("Director") and d.get("Director") != "N/A" else None,
                    "genres": d.get("Genre") if d.get("Genre") and d.get("Genre") != "N/A" else None,
                    "age_rating": d.get("Rated") if d.get("Rated") and d.get("Rated") != "N/A" else None,
                    "duration_min": runtime,
                    "imdb_id": imdb_id,
                    "imdb_rating": rating,
                    "kinopoisk_rating": None,
                })
                if len(out) >= 6:
                    break
    except (httpx.HTTPError, ValueError):
        pass
    return out


def _search_kinopoisk(q: str, api_key: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=8.0, headers={"X-API-KEY": api_key, "User-Agent": UA}) as cli:
            r = cli.get(KP_URL, params={"keyword": q, "page": 1})
            data = r.json()
            for it in (data.get("films") or [])[:6]:
                kp_id = it.get("filmId")
                # детали
                d_resp = cli.get(f"{KP_FILM_URL}/{kp_id}")
                d = d_resp.json() if d_resp.status_code == 200 else {}
                try:
                    kp_rating = float(d.get("ratingKinopoisk")) if d.get("ratingKinopoisk") else None
                except (TypeError, ValueError):
                    kp_rating = None
                try:
                    imdb_rating = float(d.get("ratingImdb")) if d.get("ratingImdb") else None
                except (TypeError, ValueError):
                    imdb_rating = None
                genres = ", ".join(g.get("genre", "") for g in (d.get("genres") or [])) or None
                out.append({
                    "source": "kinopoisk",
                    "external_id": kp_id,
                    "title": d.get("nameRu") or it.get("nameRu") or d.get("nameOriginal") or it.get("nameEn"),
                    "original_title": d.get("nameOriginal") or it.get("nameEn"),
                    "year": int(d.get("year") or it.get("year") or 0) or None,
                    "poster_url": d.get("posterUrl") or it.get("posterUrl"),
                    "description": d.get("description"),
                    "director": None,
                    "genres": genres,
                    "age_rating": d.get("ratingAgeLimits") or None,
                    "duration_min": d.get("filmLength"),
                    "imdb_id": d.get("imdbId"),
                    "imdb_rating": imdb_rating,
                    "kinopoisk_rating": kp_rating,
                })
    except (httpx.HTTPError, ValueError):
        pass
    return out


@router.get("/external-search")
def external_search(
    q: str = Query(..., min_length=2, max_length=120),
    _user = Depends(require_admin_or_super),
    db: Session = Depends(get_db),
):
    """Поиск фильма во внешних источниках + локально по уже добавленным."""
    settings = get_settings()
    omdb_key = (settings.OMDB_API_KEY or "").strip()
    kp_key = (settings.KINOPOISK_API_KEY or "").strip()

    # локальный поиск
    like = f"%{q.strip()}%"
    local_q = (
        db.query(Movie)
        .filter((Movie.title.ilike(like)) | (Movie.original_title.ilike(like)))
        .order_by(Movie.title)
        .limit(10)
        .all()
    )
    local = [{
        "source": "local",
        "movie_id": m.id,
        "title": m.title,
        "original_title": m.original_title,
        "year": m.year,
        "poster_url": m.poster_url,
        "imdb_rating": float(m.imdb_rating) if m.imdb_rating is not None else None,
        "kinopoisk_rating": float(m.kinopoisk_rating) if m.kinopoisk_rating is not None else None,
    } for m in local_q]

    external: list[dict[str, Any]] = []
    sources_used: list[str] = []
    if kp_key:
        cache_key = f"kp:{q.lower()}"
        cached = _cache_get(cache_key)
        if cached is None:
            cached = _search_kinopoisk(q, kp_key)
            _cache_put(cache_key, cached)
        external.extend(cached)
        sources_used.append("kinopoisk")
    if omdb_key:
        cache_key = f"omdb:{q.lower()}"
        cached = _cache_get(cache_key)
        if cached is None:
            cached = _search_omdb(q, omdb_key)
            _cache_put(cache_key, cached)
        external.extend(cached)
        sources_used.append("omdb")

    return {
        "configured": bool(external) or bool(omdb_key or kp_key),
        "sources": sources_used,
        "local": local,
        "external": external,
    }
