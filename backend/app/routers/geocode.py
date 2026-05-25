"""Прокси к Nominatim (OSM) для автодополнения городов и адресов.
Без API-ключа, лимит ≈1 req/s — кэшируем результаты на 5 минут."""
from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/geocode", tags=["geocode"])

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
UA = "RoofCinema/0.1 (cinema rooftop booking; russia)"
TTL_SEC = 300

_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _cached(key: str) -> list[dict[str, Any]] | None:
    item = _cache.get(key)
    if item and time.time() - item[0] < TTL_SEC:
        return item[1]
    return None


def _store(key: str, value: list[dict[str, Any]]) -> None:
    _cache[key] = (time.time(), value)


def _fetch_nominatim(params: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        with httpx.Client(timeout=6.0, headers={"User-Agent": UA, "Accept-Language": "ru,en"}) as cli:
            r = cli.get(NOMINATIM_URL, params=params)
            r.raise_for_status()
            data = r.json()
            if not isinstance(data, list):
                return []
            return data
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Геокодер недоступен: {e}")


@router.get("/cities")
def search_cities(q: str = Query(..., min_length=2, max_length=80)):
    """Подсказки городов России по началу названия."""
    key = f"city:{q.strip().lower()}"
    cached = _cached(key)
    if cached is not None:
        return cached
    data = _fetch_nominatim({
        "q": q,
        "countrycodes": "ru",
        "format": "json",
        "addressdetails": 1,
        "limit": 10,
        "accept-language": "ru",
    })
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for it in data:
        if it.get("class") != "place" and it.get("class") != "boundary":
            continue
        if it.get("type") not in ("city", "town", "village", "hamlet", "administrative"):
            continue
        addr = it.get("address", {})
        name = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("hamlet")
            or it.get("name", "")
        )
        if not name:
            continue
        state = addr.get("state", "")
        key2 = (name, state)
        if key2 in seen:
            continue
        seen.add(key2)
        out.append({
            "name": name,
            "region": state,
            "display": ", ".join(p for p in [name, state] if p),
        })
        if len(out) >= 8:
            break
    _store(key, out)
    return out


@router.get("/addresses")
def search_addresses(
    q: str = Query(..., min_length=2, max_length=120),
    city: str = Query(..., min_length=2, max_length=80),
):
    """Подсказки адресов внутри указанного города. Возвращает lat/lng."""
    q_norm = q.strip().lower()
    city_norm = city.strip().lower()
    key = f"addr:{city_norm}|{q_norm}"
    cached = _cached(key)
    if cached is not None:
        return cached
    data = _fetch_nominatim({
        "q": f"{q}, {city}, Россия",
        "countrycodes": "ru",
        "format": "json",
        "addressdetails": 1,
        "limit": 10,
        "accept-language": "ru",
    })
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for it in data:
        addr = it.get("address", {})
        item_city = (
            addr.get("city") or addr.get("town") or addr.get("village") or ""
        ).lower()
        if item_city and city_norm not in item_city and item_city not in city_norm:
            continue
        road = addr.get("road") or addr.get("pedestrian") or addr.get("residential") or ""
        house = addr.get("house_number") or ""
        if road:
            display = road + (", " + house if house else "")
        else:
            display = (it.get("display_name") or "").split(",")[0].strip()
        if not display or display in seen:
            continue
        seen.add(display)
        try:
            lat = float(it["lat"])
            lng = float(it["lon"])
        except (KeyError, ValueError, TypeError):
            continue
        out.append({
            "address": display,
            "lat": lat,
            "lng": lng,
            "display": display,
            "full_display": it.get("display_name", display),
        })
        if len(out) >= 8:
            break
    _store(key, out)
    return out
