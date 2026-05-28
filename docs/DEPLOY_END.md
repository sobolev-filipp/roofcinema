# 🚀 Руководство по деплою RoofCinema на VPS

## Стек
- **Backend**: FastAPI + SQLite + папка `uploads/`
- **Frontend**: React + Vite (статические файлы)
- **Процесс-менеджер**: systemd (uvicorn)
- **Веб-сервер**: Nginx

> **Про базу данных.** Проект использует **SQLite** — файловая БД, отдельный сервер не нужен.
> Бэкап = просто скопировать один файл `roofcinema.db`. Для кинотеатра на крышах этого достаточно.
> Если в будущем понадобится PostgreSQL — см. раздел «Переезд на PostgreSQL» в конце.

---

## 📋 Что нужно иметь заранее

1. **IP-адрес** и **root-пароль** — из письма rdp-onedash.ru
2. **SSH-клиент** — [Tabby](https://tabby.sh/) или стандартный `ssh` в терминале Windows
3. **SFTP-клиент** — [FileZilla](https://filezilla-project.org/) или [WinSCP](https://winscp.net/)
4. **Домен** (опционально). Без домена всё работает по IP

---

## 🔌 ЧАСТЬ 1: Подключение к серверу

```bash
ssh root@93.88.203.172
```

При первом подключении введите `yes`, затем пароль из письма.

---

## ⚙️ ЧАСТЬ 2: Первичная настройка сервера (один раз)

### 2.1 Обновление системы

```bash
apt update && apt upgrade -y
```

### 2.2 Установка Node.js 20+ (обязательно именно 20+)

> ⚠️ **Важно:** стандартный `apt install nodejs` ставит старую версию 18, с которой сборка
> фронтенда не работает. Устанавливайте строго через nodesource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

Проверка — должно быть `v20.x.x`:
```bash
node --version
```

### 2.3 Установка остальных пакетов

```bash
apt install -y python3 python3-pip python3-venv nginx git curl certbot python3-certbot-nginx
```

### 2.4 Создание рабочей директории

```bash
mkdir -p /var/www/roofcinema
```

---

## 📦 ЧАСТЬ 3: Загрузка кода на сервер

### Вариант А — Git (рекомендуется, обновления одной командой)

**На вашем компьютере** создайте `.gitignore` в корне проекта `F:\Проекты\RoofCinema\`:

```gitignore
# Python
__pycache__/
*.pyc
*.pyo
.env
venv/
*.db
*.db-journal

# Загруженные файлы пользователей — не хранить в git
backend/uploads/*
!backend/uploads/.gitkeep

# Node
frontend/node_modules/
frontend/dist/

# OS
.DS_Store
Thumbs.db
```

Создайте заглушку для папки uploads:

```bash
# Windows (в папке проекта)
type nul > backend\uploads\.gitkeep
```

Создайте репозиторий на [github.com](https://github.com) и запушьте проект:

```bash
# В папке F:\Проекты\RoofCinema
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/ВАШ_ЛОГИН/roofcinema.git
git push -u origin main
```

**На сервере** — клонируем:

```bash
cd /var/www/roofcinema
git clone https://github.com/ВАШ_ЛОГИН/roofcinema.git .
```

### Вариант Б — SFTP (FileZilla / WinSCP)

Подключитесь по SFTP (хост: IP, пользователь: root) и загрузите папки `backend/` и `frontend/` в `/var/www/roofcinema/`.

---

## 🐍 ЧАСТЬ 4: Настройка бэкенда

### 4.1 Python-окружение и зависимости

```bash
cd /var/www/roofcinema
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
```

### 4.2 Папки для данных

```bash
# БД хранится отдельно от кода — при обновлениях не затрагивается
mkdir -p /var/www/roofcinema/data
mkdir -p /var/www/roofcinema/backend/uploads
```

### 4.3 Создание файла .env

`.env` — файл с секретными настройками. Не хранится в git, создаётся один раз вручную.

#### Способ 1 — Загрузить через SFTP (проще всего)

1. На своём компьютере создайте файл `roofcinema.env` с содержимым ниже
2. Загрузите через FileZilla в `/var/www/roofcinema/backend/`
3. Переименуйте на сервере:
   ```bash
   mv /var/www/roofcinema/backend/roofcinema.env /var/www/roofcinema/backend/.env
   ```

#### Способ 2 — Создать прямо на сервере через nano

```bash
nano /var/www/roofcinema/backend/.env
```

> **Управление nano:**
> - Стрелки — перемещение, просто печатайте текст
> - `Ctrl + K` — вырезать строку, `Ctrl + U` — вставить
> - `Ctrl + X` → `Y` → `Enter` — сохранить и выйти

---

#### Содержимое .env (замените значения на свои)

```env
# База данных — АБСОЛЮТНЫЙ путь (вне папки с кодом, чтобы не затиралась при обновлениях)
DATABASE_URL=sqlite:////var/www/roofcinema/data/roofcinema.db

# Секретный ключ JWT — сгенерируйте командой ниже
SECRET_KEY=СГЕНЕРИРУЙТЕ_ДЛИННУЮ_СЛУЧАЙНУЮ_СТРОКУ

# CORS — ваш домен или IP (оба варианта через запятую)
CORS_ORIGINS=https://ВАШ_ДОМЕН.RU,http://ВАШ_IP

# Первый суперадмин — данные для входа в панель
SUPER_ADMIN_EMAIL=ваш@email.ru
SUPER_ADMIN_PASSWORD=оченьНадёжныйПароль123!
SUPER_ADMIN_NAME=Владелец

# API-ключи для поиска фильмов (можно оставить пустыми)
OMDB_API_KEY=
KINOPOISK_API_KEY=

# Email (SMTP) — для отправки писем пользователям
# Если оставить SMTP_HOST пустым — письма будут выводиться только в консоль
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=587
SMTP_USER=ваш@yandex.ru
SMTP_PASSWORD=пароль_приложения
SMTP_FROM=ваш@yandex.ru
SMTP_USE_TLS=true

# Базовый URL для ссылок в письмах (ваш сайт)
APP_BASE_URL=https://ВАШ_ДОМЕН.RU
```

**Генерация SECRET_KEY — выполните на сервере:**

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

### 4.4 Тест запуска бэкенда

```bash
cd /var/www/roofcinema/backend
source /var/www/roofcinema/venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Если видите `Application startup complete` — отлично. Нажмите `Ctrl+C`.

### 4.5 Systemd-сервис (автозапуск бэкенда)

```bash
nano /etc/systemd/system/roofcinema.service
```

```ini
[Unit]
Description=RoofCinema Backend (FastAPI)
After=network.target

[Service]
User=root
WorkingDirectory=/var/www/roofcinema/backend
ExecStart=/var/www/roofcinema/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Запуск и включение автостарта:

```bash
systemctl daemon-reload
systemctl enable roofcinema
systemctl start roofcinema
systemctl status roofcinema    # должно быть: Active: active (running)
```

---

## ⚛️ ЧАСТЬ 5: Сборка фронтенда

```bash
cd /var/www/roofcinema/frontend
npm install
npm run build
```

Сборка занимает ~10–30 секунд. Успешный результат выглядит так:
```
✓ 93 modules transformed.
dist/index.html    1.10 kB
dist/assets/...
✓ built in 7.95s
```

Проверьте что папка создалась:
```bash
ls /var/www/roofcinema/frontend/dist/
# Должны быть: index.html, assets/, sw.js, ...
```

### ⚠️ Возможные ошибки при сборке

**Ошибка: `tsc: Permission denied`**

Возникает если `node_modules` пришёл с Windows через git/SFTP и потерял флаг исполняемости.
Исправление:
```bash
rm -rf node_modules
npm install
npm run build
```

**Ошибка: `WARN EBADENGINE` — Unsupported engine**

Просто предупреждения о совместимости, не ошибки — сборка продолжится и завершится успешно.
Если сборка всё же упала из-за версии Node, проверьте:
```bash
node --version   # нужно v20+
```
Если меньше 20 — переустановите (см. Часть 2.2).

**Ошибка TypeScript (например, `error TS18047: ... is possibly 'null'`)**

Это ошибка в коде, не в окружении. Нужно исправить на компьютере, закоммитить и снова собрать:
```bash
# На вашем компьютере — исправьте ошибку, затем:
git add .
git commit -m "fix: ..."
git push origin main

# На сервере:
git pull origin main
npm run build
```

---

## 🌐 ЧАСТЬ 6: Настройка Nginx

```bash
nano /etc/nginx/sites-available/roofcinema
```

```nginx
server {
    listen 80;
    server_name ВАШ_ДОМЕН.RU www.ВАШ_ДОМЕН.RU;

    # Максимальный размер загружаемых файлов (чеки, фото)
    client_max_body_size 20M;

    # ── Фронтенд (React SPA) ────────────────────────────────────
    root /var/www/roofcinema/frontend/dist;
    index index.html;

    # Все маршруты React-роутера отдаём через index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ── Статика загрузок (фото крыш, чеки) ─────────────────────
    location /uploads/ {
        alias /var/www/roofcinema/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # ── Backend API ─────────────────────────────────────────────
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # ── WebSocket (реалтайм уведомления) ────────────────────────
    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

Активация:

```bash
ln -s /etc/nginx/sites-available/roofcinema /etc/nginx/sites-enabled/
nginx -t                  # должно быть: syntax is ok
systemctl reload nginx
```

> ⚠️ **Nginx не запускайте до того как собрали фронтенд** (`dist/` должна существовать).
> Если Nginx запущен без `dist/` — он уходит в бесконечный цикл редиректов и отдаёт 500.

---

## 🔒 ЧАСТЬ 7: Бесплатный HTTPS-сертификат (Let's Encrypt)

> Сертификат выдаётся бесплатно, действует 90 дней, обновляется автоматически.
> **Обязательное условие:** DNS-записи домена уже должны указывать на IP вашего сервера.

### 7.1 Настройте DNS-записи у регистратора домена

Зайдите на сайт, где куплен домен → **«Управление DNS»** → добавьте две записи:

| Тип | Имя / Subdomain | Значение (IP сервера) | TTL |
|-----|-----------------|-----------------------|-----|
| **A** | `@` | `ВАШ_IP_СЕРВЕРА` | 3600 |
| **A** | `www` | `ВАШ_IP_СЕРВЕРА` | 3600 |

Узнать IP сервера:
```bash
curl ifconfig.me
```

### 7.2 Дождитесь обновления DNS (5–30 минут)

Проверяйте на сервере:
```bash
nslookup ВАШ_ДОМЕН.RU
```

Когда в ответе появится ваш IP — можно продолжать:
```
Name:    ВАШ_ДОМЕН.RU
Address: ВАШ_IP_СЕРВЕРА
```

Или онлайн: [dnschecker.org](https://dnschecker.org)

### 7.3 Получите сертификат

```bash
certbot --nginx -d ВАШ_ДОМЕН.RU -d www.ВАШ_ДОМЕН.RU
```

Certbot задаст два вопроса:
1. **Email** — введите ваш (для уведомлений)
2. **Agree to terms** — введите `Y`

Certbot сам изменит конфиг Nginx и добавит HTTPS.

### 7.4 Проверьте автообновление

```bash
certbot renew --dry-run
# Ожидается: "Congratulations, all simulated renewals succeeded"
```

### Частые ошибки certbot

**`NXDOMAIN` — DNS problem**
```
DNS problem: NXDOMAIN looking up A for ВАШ_ДОМЕН.RU
```
→ DNS-записи не прописаны или не обновились. Вернитесь к шагу 7.1–7.2 и подождите.

**`Connection refused` или `Timeout`**
→ Nginx не запущен: `systemctl start nginx`

---

## ✅ ЧАСТЬ 8: Финальная проверка

```bash
# Статус сервисов
systemctl status roofcinema
systemctl status nginx

# Тест API (через GET-запрос)
curl http://localhost:8000/api/health
# Ожидается: {"status":"ok"}

# Тест через Nginx (обязательно curl, не просто URL в терминале!)
curl https://ВАШ_ДОМЕН.RU/api/health
# Ожидается: {"status":"ok"}
```

> ⚠️ **Не вводите URL в терминал без `curl`** — `http://...` это не команда bash,
> будет ошибка `No such file or directory`.

---

## 🔄 ЧАСТЬ 9: Обновление сайта без потери данных

### Скрипт обновления (создать один раз на сервере)

```bash
nano /var/www/roofcinema/deploy.sh
```

```bash
#!/bin/bash
set -e  # при любой ошибке — стоп

echo "=== Обновление RoofCinema ==="

cd /var/www/roofcinema

echo "→ Получаем изменения из git..."
git pull origin main

echo "→ Обновляем Python-зависимости..."
source venv/bin/activate
pip install -q -r backend/requirements.txt

echo "→ Собираем фронтенд..."
cd frontend
# Удаляем node_modules перед установкой — избегаем проблем с правами
rm -rf node_modules
npm install --silent
npm run build
cd ..

echo "→ Перезапускаем бэкенд..."
systemctl restart roofcinema

echo "→ Перезагружаем Nginx..."
systemctl reload nginx

echo ""
echo "✅ Готово! Сайт обновлён."
echo "   БД:       /var/www/roofcinema/data/roofcinema.db  — не тронута"
echo "   Загрузки: /var/www/roofcinema/backend/uploads/    — не тронуты"
echo "   .env:     /var/www/roofcinema/backend/.env        — не тронут"
```

```bash
chmod +x /var/www/roofcinema/deploy.sh
```

### Процесс обновления (каждый раз)

**Шаг 1 — на вашем компьютере:**

```bash
git add .
git commit -m "описание изменений"
git push origin main
```

**Шаг 2 — на сервере (одна команда):**

```bash
/var/www/roofcinema/deploy.sh
```

**Шаг 3 - Если нужно перезагрузить сервер

```bash
Н
```

База данных, загруженные файлы и `.env` не затрагиваются.

---

## 💾 ЧАСТЬ 10: Резервное копирование БД

### Ручной бэкап

```bash
cp /var/www/roofcinema/data/roofcinema.db \
   /var/www/roofcinema/data/roofcinema_backup_$(date +%Y%m%d_%H%M).db
```

### Автоматический бэкап каждый день в 3:00

```bash
crontab -e
```

Нажмите 1 (или просто Enter) — откроется nano.

Добавьте строку:

```
0 3 * * * cp /var/www/roofcinema/data/roofcinema.db /var/www/roofcinema/data/roofcinema_$(date +\%Y\%m\%d).db && find /var/www/roofcinema/data -name "roofcinema_*.db" -mtime +7 -delete
```

Создаёт ежедневную копию, удаляет копии старше 7 дней.

### Скачать БД на компьютер

```bash
# Выполнить в терминале на вашем компьютере
scp root@ВАШ_IP:/var/www/roofcinema/data/roofcinema.db C:\Users\filip\Desktop\roofcinema_backup.db
```

---

## 🆘 Диагностика — полезные команды

```bash
# Статус и логи бэкенда
systemctl status roofcinema
journalctl -u roofcinema -n 100 --no-pager

# Логи в реальном времени
journalctl -u roofcinema -f

# Логи Nginx
tail -50 /var/log/nginx/error.log
tail -50 /var/log/nginx/access.log

# Перезапуск сервисов
systemctl restart roofcinema
systemctl reload nginx

# Проверить что порт 8000 слушается
ss -tlnp | grep 8000

# Проверить версии
node --version
python3 --version
nginx -v
```

---

## 📁 Итоговая структура файлов на сервере

```
/var/www/roofcinema/
├── backend/                  ← код бэкенда (из git, обновляется)
│   ├── app/
│   ├── .env                  ← СЕКРЕТЫ — не в git, создаётся вручную один раз
│   └── uploads/              ← загруженные файлы — не в git, не трогать при обновлении
├── frontend/                 ← код фронтенда (из git, обновляется)
│   └── dist/                 ← собранный фронт (пересоздаётся при каждом обновлении)
├── data/
│   └── roofcinema.db         ← БАЗА ДАННЫХ — не в git, не трогать при обновлении
├── venv/                     ← Python-окружение (создаётся один раз)
└── deploy.sh                 ← скрипт обновления
```

> **Главное правило**: `data/roofcinema.db`, `backend/uploads/`, `backend/.env` —
> никогда не попадают в git и никогда не перезаписываются при обновлении кода.

---

## 🐘 Переезд на PostgreSQL (опционально, для высокой нагрузки)

> Нужно только если SQLite перестанет справляться (тысячи одновременных бронирований).
> Для старта SQLite полностью достаточен.

### Установка и настройка PostgreSQL

```bash
apt install -y postgresql postgresql-contrib

sudo -u postgres psql

CREATE DATABASE roofcinema;
CREATE USER roofcinema_user WITH PASSWORD 'придумайте_пароль';
GRANT ALL PRIVILEGES ON DATABASE roofcinema TO roofcinema_user;
\q
```

### Установка Python-драйвера

Добавьте в `backend/requirements.txt`:
```
psycopg2-binary==2.9.10
```

```bash
source /var/www/roofcinema/venv/bin/activate
pip install psycopg2-binary
```

### Изменение DATABASE_URL в .env

```env
DATABASE_URL=postgresql://roofcinema_user:придумайте_пароль@localhost:5432/roofcinema
```

```bash
systemctl restart roofcinema
```

> ⚠️ При переезде с SQLite данные нужно переносить отдельно — таблицы создадутся пустыми.
