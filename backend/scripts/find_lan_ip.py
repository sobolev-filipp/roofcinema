"""Печатает локальный IP-адрес машины в LAN — удобно, когда нужно открыть сайт
с телефона / другого устройства в той же Wi-Fi сети."""
from __future__ import annotations

import socket


def get_lan_ip() -> str:
    # Хитрый трюк: подключаемся к "внешнему" UDP-адресу — реальной отправки нет,
    # но ОС выбирает интерфейс по умолчанию и его IP можно узнать.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    ip = get_lan_ip()
    print(f"LAN IP: {ip}")
    print(f"Открой с телефона: http://{ip}:5180")
