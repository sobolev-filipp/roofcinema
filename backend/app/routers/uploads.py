"""Загрузка изображений (постеры, кадры). Файлы складываются в backend/uploads/
и раздаются статически по пути /uploads/<name>."""
from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..deps import require_admin_or_super

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXT = {"jpg", "jpeg", "png", "webp", "gif", "avif"}
MAX_SIZE = 8 * 1024 * 1024  # 8 МБ


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    _admin = Depends(require_admin_or_super),
):
    ct = (file.content_type or "").lower()
    if not ct.startswith("image/"):
        raise HTTPException(status_code=400, detail="Можно загружать только изображения")

    # Расширение из content-type или имени
    ext = ct.split("/", 1)[1].split(";", 1)[0]
    if ext == "jpeg":
        ext = "jpg"
    if ext not in ALLOWED_EXT:
        # пробуем по имени файла
        if file.filename and "." in file.filename:
            ext = file.filename.rsplit(".", 1)[1].lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(status_code=400, detail=f"Неподдерживаемый формат. Разрешены: {', '.join(sorted(ALLOWED_EXT))}")

    # Читаем в память с ограничением размера
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=413, detail=f"Файл слишком большой (максимум {MAX_SIZE // 1024 // 1024} МБ)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Файл пустой")

    name = f"{secrets.token_urlsafe(16)}.{ext}"
    path = UPLOAD_DIR / name
    path.write_bytes(data)

    return {"url": f"/uploads/{name}", "size": len(data), "filename": name}
