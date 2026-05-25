"""Кросс-платформенный запускатор backend в режиме разработки.

Использует тот же Python, под которым запущен (sys.executable), и сам находит uvicorn.
Не зависит от того, Windows это или macOS/Linux.

Запуск:
    python run_dev.py            # 127.0.0.1:8010 (только локально)
    python run_dev.py --lan      # 0.0.0.0:8010 (доступен в локальной сети)
"""
from __future__ import annotations

import argparse
import sys

import uvicorn


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default=None)
    p.add_argument("--port", type=int, default=8010)
    p.add_argument("--lan", action="store_true", help="Слушать на 0.0.0.0 (для тестов с других устройств в той же Wi-Fi)")
    p.add_argument("--no-reload", action="store_true")
    args = p.parse_args()

    host = args.host or ("0.0.0.0" if args.lan else "127.0.0.1")
    uvicorn.run(
        "app.main:app",
        host=host,
        port=args.port,
        reload=not args.no_reload,
        log_level="info",
    )


if __name__ == "__main__":
    sys.exit(main())
