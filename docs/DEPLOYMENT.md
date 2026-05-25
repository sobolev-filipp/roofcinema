# Развёртывание «Кино на крыше» на сервере

Подробная пошаговая инструкция, рассчитанная на человека, который никогда не разворачивал сайты. Все команды можно копировать целиком.

После выполнения у тебя будет:
- работающий сайт на твоём домене (`https://mycinema.ru`),
- HTTPS-сертификат (бесплатный, авто-обновляемый),
- PostgreSQL вместо SQLite,
- автоматический перезапуск backend при сбое или ребуте сервера,
- WebSocket для реал-тайма у админа,
- ежедневные бэкапы базы.

**Сколько это стоит:**
- VPS (виртуальный сервер) — от **150 ₽/мес**
- Домен `.ru` или `.рф` — **100–300 ₽/год**
- HTTPS-сертификат — **бесплатно** (Let's Encrypt)
- **Итого: ~150 ₽/мес + 200 ₽/год**

**Сколько времени:** часа полтора при первом разе.

---

## Содержание

1. [Шаг 1. Заказ VPS](#шаг-1-заказ-vps)
2. [Шаг 2. Регистрация домена](#шаг-2-регистрация-домена)
3. [Шаг 3. Подключение к серверу по SSH](#шаг-3-подключение-к-серверу-по-ssh)
4. [Шаг 4. Базовая настройка сервера](#шаг-4-базовая-настройка-сервера)
5. [Шаг 5. Установка нужного ПО](#шаг-5-установка-нужного-по)
6. [Шаг 6. Настройка PostgreSQL](#шаг-6-настройка-postgresql)
7. [Шаг 7. Клонирование проекта и backend](#шаг-7-клонирование-проекта-и-backend)
8. [Шаг 8. Сборка фронтенда](#шаг-8-сборка-фронтенда)
9. [Шаг 9. Запуск backend как systemd-сервис](#шаг-9-запуск-backend-как-systemd-сервис)
10. [Шаг 10. Настройка nginx (reverse proxy)](#шаг-10-настройка-nginx-reverse-proxy)
11. [Шаг 11. Привязка домена (DNS)](#шаг-11-привязка-домена-dns)
12. [Шаг 12. HTTPS-сертификат](#шаг-12-https-сертификат)
13. [Шаг 13. Финальная проверка](#шаг-13-финальная-проверка)
14. [Шаг 14. Бэкапы базы](#шаг-14-бэкапы-базы)
15. [Шаг 15. Обновление проекта](#шаг-15-обновление-проекта)
16. [Что ещё стоит сделать](#что-ещё-стоит-сделать)
17. [Если что-то сломалось](#если-что-то-сломалось)

---

## Шаг 1. Заказ VPS

**VPS** (Virtual Private Server) — виртуальный сервер в дата-центре, который ты арендуешь. По сути, это удалённый Linux-компьютер, к которому подключаешься по сети.

### Рекомендуемые провайдеры (для проекта в РФ)

| Провайдер | Цена от | Где | Плюсы |
|-----------|---------|-----|-------|
| **[Timeweb Cloud](https://timeweb.cloud/)** | 150 ₽/мес | Москва, СПб, Алматы | Удобный кабинет, быстрая поддержка, есть Docker-готовые конфиги |
| **[Selectel](https://selectel.ru/)** | 300 ₽/мес | Москва, СПб, Новосибирск | Самый стабильный, корпоративный уровень |
| **[Beget](https://beget.com/ru/vps)** | 150 ₽/мес | Москва, СПб | Простой кабинет, хороший для новичка |
| **[FirstByte](https://firstbyte.ru/)** | 99 ₽/мес | Москва, СПб | Самый дешёвый, базовая поддержка |
| **[Reg.ru Cloud](https://www.reg.ru/cloud-vps/)** | 200 ₽/мес | Москва | Удобно сразу с доменом в одном кабинете |

Зарубежные (для проектов с международной аудиторией):
- **[Hetzner](https://www.hetzner.com/cloud)** (Германия) — €4-5/мес, лучший price/perf
- **[DigitalOcean](https://www.digitalocean.com/)** — $4-6/мес

### Какую конфигурацию брать

Для проекта на старте достаточно:
- **CPU:** 1–2 ядра
- **RAM:** 2 GB (1 GB будет тесновато)
- **Диск:** 20–40 GB SSD
- **ОС:** **Ubuntu 22.04 LTS** или **Ubuntu 24.04 LTS** (выбирай при заказе)
- **Регион:** ближайший к большинству пользователей (для РФ — Москва)

### После заказа провайдер пришлёт

- **IP-адрес** сервера (например, `194.58.112.45`)
- **Пароль root** (или ты сам его задашь при заказе)

##Хост: 93.88.203.172
##Пароль: x82RcJ6Qy9pwR


Сохрани их.

---

## Шаг 2. Регистрация домена

Домен — это адрес сайта, например `mycinema.ru`. Без него сайт будет работать только по IP, но это некрасиво, и HTTPS не получишь.

### Где регистрировать

- **[Reg.ru](https://www.reg.ru/)** — самый популярный, 200 ₽/год за `.ru`
- **[Beget](https://beget.com/ru/domains)** — 199 ₽/год за `.ru`
- **[Timeweb](https://timeweb.com/ru/services/domains/)** — 199 ₽/год
- **[nic.ru](https://www.nic.ru/)** — старейший, но дороже

Поиск имени → выбор → оплата. Регистрация занимает 5–10 минут.

### Какое имя выбрать

- Короткое и запоминающееся
- Зона `.ru` или `.рф` — для российской аудитории; `.com` — если планируется международная
- Проверь, что не нарушаешь торговую марку

После регистрации **DNS пока не настраиваем** — это будет в [Шаге 11](#шаг-11-привязка-домена-dns), после того как сервер настроен.

---

## Шаг 3. Подключение к серверу по SSH

**SSH** — протокол для удалённого управления Linux-сервером через терминал.

### Если у тебя Windows

Открой **PowerShell** или **Windows Terminal** и выполни:

```powershell
ssh root@93.88.203.172
```

(подставь свой IP). При первом подключении спросит «Are you sure you want to continue connecting?» — ответь `yes`. Потом введи пароль root, который выдал провайдер.

### Если у тебя macOS / Linux

Открой **Terminal**, та же команда:

```bash
ssh root@93.88.203.172
```
#Password:C9RgYEfdhVWgx

После успешного входа ты увидишь приглашение типа:

```
root@my-server:~#
```

С этого момента ты на сервере, и все следующие команды выполняются там.

---

## Шаг 4. Базовая настройка сервера

### 4.1. Обновим систему

```bash
apt update && apt upgrade -y
```

Это займёт несколько минут. Если спросит про обновление конфигов — жми Enter (оставить дефолт).

### 4.2. Создадим непривилегированного пользователя

Под root всё работать опасно — сделаем отдельного юзера для приложения:

```bash
adduser roofadmin
```

Введи надёжный пароль (запомни его!), остальные поля можно оставить пустыми (просто жми Enter).
(33774Dancom)
Full Name []: roofadmin
Room Number []: 1
Work Phone []: 89234380628
Home Phone []: 89234380628

Дадим ему `sudo`-права:

```bash
usermod -aG sudo roofadmin
```

### 4.3. Настроим firewall (брандмауэр)

Установим `ufw` (Uncomplicated Firewall) и откроем только нужные порты:

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

Должно показать активный фаервол с открытыми портами 22 (SSH), 80 (HTTP), 443 (HTTPS).

### 4.4. (опционально) Подключение по SSH-ключу вместо пароля

Это удобнее и безопаснее. Можно пропустить, но рекомендую.

**На своём компьютере** (выйди из SSH-сессии, нажав Ctrl+D, либо открой новый терминал):

```bash
# создать ключ (если ещё нет)
ssh-keygen -t ed25519                # просто жми Enter на все вопросы

# скопировать публичную часть на сервер
ssh-copy-id roofcinema@93.88.203.172
```

(На Windows `ssh-copy-id` нет — можно вручную: открой `C:\Users\ИМЯ\.ssh\id_ed25519.pub` в блокноте, скопируй содержимое, потом на сервере под пользователем `roofcinema`: `mkdir -p ~/.ssh && nano ~/.ssh/authorized_keys`, вставь, Ctrl+O, Enter, Ctrl+X.)

Теперь подключайся без пароля:

```bash
ssh roofcinema@93.88.203.172
```

---

## Шаг 5. Установка нужного ПО

Все следующие команды — на сервере под `roofcinema` (или под root + `sudo` каждой команды).

Если ты под пользователем `roofcinema` — перед каждой командой, требующей прав, пиши `sudo`.

```bash
sudo apt install -y python3 python3-venv python3-pip \
                    postgresql postgresql-contrib \
                    nginx \
                    git curl \
                    certbot python3-certbot-nginx \
                    build-essential libpq-dev
```

Установим **Node.js 20** (нужен для сборки фронтенда):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version       # должно вывести v20.x
```

Проверим версии:

```bash
python3 --version    # 3.11.x или 3.12.x
psql --version       # 16.x
nginx -v             # 1.24.x
```

---

## Шаг 6. Настройка PostgreSQL

В dev-режиме мы использовали SQLite — файл `roofcinema.db`. Для прода нужна настоящая база с резервированием.

```bash
sudo -u postgres psql
```

Откроется консоль PostgreSQL `postgres=#`. Внутри неё выполни:

```sql
CREATE USER roofcinema WITH PASSWORD '33774Dancom';
CREATE DATABASE roofcinema OWNER roofcinema;
GRANT ALL PRIVILEGES ON DATABASE roofcinema TO roofcinema;
\q
```

**Важно:** запиши пароль — он понадобится через минуту. Можешь сгенерировать командой `openssl rand -base64 24`.

Проверим, что подключается:

```bash
psql -h 127.0.0.1 -U roofcinema -d roofcinema
# попросит пароль — введи
\q
```

---

## Шаг 7. Клонирование проекта и backend

### 7.1. Клонируем код

Если код в Git (рекомендую):

```bash
cd ~
git clone https://github.com/sobolev-filipp/roofcinema
cd roofcinema
```

Если кода нет в Git — сначала залей его на GitHub/GitLab. Или используй `scp` / `rsync`, чтобы скопировать с локального компьютера:

```bash
# на локальной машине (Windows: в PowerShell нужен OpenSSH-клиент или WSL)
scp -r F:/Проекты/RoofCinema/* roofcinema@93.88.203.172:/home/roofcinema/roofcinema/
```

### 7.2. Поднимем виртуальное окружение Python

```bash
cd ~/roofcinema/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install psycopg2-binary    # PostgreSQL-драйвер, не нужен в dev с SQLite
```

### 7.3. Настроим .env для production

```bash
cp .env.example .env
nano .env
```

Минимальный prod-конфиг (поменяй на свои значения):

```env
# --- база ---
DATABASE_URL=postgresql+psycopg2://roofcinema:33774Dancom@127.0.0.1:5432/roofcinema

# --- безопасность ---
SECRET_KEY=ВСТАВЬ_СЮДА_ДЛИННУЮ_СЛУЧАЙНУЮ_СТРОКУ
ACCESS_TOKEN_EXPIRE_MINUTES=10080

# --- CORS — твой домен ---
CORS_ORIGINS=https://mycinema.ru,https://www.mycinema.ru

# --- админ ---
SUPER_ADMIN_EMAIL=owner@mycinema.ru
SUPER_ADMIN_PASSWORD=changeme_at_first_login
SUPER_ADMIN_NAME=Владелец

# --- ссылки в письмах ---
APP_BASE_URL=https://mycinema.ru

# --- SMTP — для подтверждения email и сброса пароля ---
# см. docs/SMTP_GUIDE.md
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=587
SMTP_USER=noreply@mycinema.ru
SMTP_PASSWORD=пароль_приложения
SMTP_FROM=noreply@mycinema.ru
SMTP_USE_TLS=true

# --- API-ключи (опционально) ---
OMDB_API_KEY=
KINOPOISK_API_KEY=
```

**Сгенерировать `SECRET_KEY`:**

```bash
openssl rand -hex 32
```

Сохрани файл: Ctrl+O, Enter, Ctrl+X.

### 7.4. Проверим, что backend запускается

```bash
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010
```

В новом терминале (подключись ещё раз по SSH):

```bash
curl http://127.0.0.1:8010/api/health
# должно вернуть {"status":"ok"}
```

Если ок — вернись в первый терминал и нажми Ctrl+C, чтобы остановить.

---

## Шаг 8. Сборка фронтенда

```bash
cd ~/roofcinema/frontend
npm install
```

Перед сборкой нужно поправить файл, чтобы фронт стучался не в Vite-прокси, а в твой реальный домен:

В файле `frontend/src/api.ts` (или где fetch-ы) URLs у нас уже **относительные** (`/api/...`, `/uploads/...`) — nginx сам перенаправит их в backend. Менять ничего не нужно.

Собираем:

```bash
npm run build
```

В папке `frontend/dist/` появятся готовые статические файлы. Перенесём их в стандартное место для веб-контента:

```bash
sudo mkdir -p /var/www/roofcinema
sudo cp -r dist/* /var/www/roofcinema/
sudo chown -R www-data:www-data /var/www/roofcinema
```

---

## Шаг 9. Запуск backend как systemd-сервис

`systemd` — встроенный в Linux менеджер сервисов. Сделаем так, чтобы backend стартовал автоматически при загрузке и перезапускался при сбое.

Создадим юнит-файл:

```bash
sudo nano /etc/systemd/system/roofcinema-backend.service
```

Вставь (нажми правой кнопкой мыши в PuTTY или Cmd+V в macOS terminal):

```ini
[Unit]
Description=RoofCinema Backend (FastAPI/uvicorn)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=roofcinema
Group=roofcinema
WorkingDirectory=/home/roofcinema/roofcinema/backend
EnvironmentFile=/home/roofcinema/roofcinema/backend/.env
ExecStart=/home/roofcinema/roofcinema/backend/.venv/bin/uvicorn app.main:app \
    --host 127.0.0.1 \
    --port 8010 \
    --workers 2 \
    --proxy-headers \
    --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=5

# Безопасность: ограничим что может приложение
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/home/roofcinema/roofcinema/backend/uploads /home/roofcinema/roofcinema/backend
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Сохрани (Ctrl+O, Enter, Ctrl+X) и запусти:

```bash
sudo systemctl daemon-reload
sudo systemctl enable roofcinema-backend
sudo systemctl start roofcinema-backend
sudo systemctl status roofcinema-backend
```

В выводе должно быть `active (running)` зелёным.

Если ошибка — посмотри логи:

```bash
sudo journalctl -u roofcinema-backend -n 50 --no-pager
```

---

## Шаг 10. Настройка nginx (reverse proxy)

`nginx` будет:
- отдавать готовые HTML/JS/CSS из `/var/www/roofcinema/`,
- проксировать `/api/...` и `/uploads/...` на backend,
- проксировать WebSocket для реалтайма админу,
- позже подхватит HTTPS-сертификат.

Создадим конфиг сайта:

```bash
sudo nano /etc/nginx/sites-available/roofcinema
```

Вставь (поменяй `mycinema.ru` на свой домен):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name mycinema.ru www.mycinema.ru;

    # Логи
    access_log /var/log/nginx/roofcinema.access.log;
    error_log /var/log/nginx/roofcinema.error.log;

    # Максимальный размер загружаемого файла (для постеров фильмов)
    client_max_body_size 10M;

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:8010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket (для админ-бронирований real-time)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }

    # Загруженные постеры / кадры / аватары
    location /uploads/ {
        proxy_pass http://127.0.0.1:8010;
        proxy_set_header Host $host;
        proxy_cache_valid 200 1d;
    }

    # Статика React
    root /var/www/roofcinema;
    index index.html;

    # Кеш для JS/CSS с хешами в именах
    location ~* \.(?:js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|webp|avif|svg|ico)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Все остальные пути отдаём index.html (SPA-роутинг)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Сохрани, активируй сайт, отключи дефолтный, проверь синтаксис:

```bash
sudo ln -s /etc/nginx/sites-available/roofcinema /etc/nginx/sites-enabled/roofcinema
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` должна сказать `syntax is ok` и `test is successful`.

---

## Шаг 11. Привязка домена (DNS)

Сейчас сайт доступен только по IP. Привяжем домен.

Зайди в **кабинет регистратора домена** (Reg.ru / Beget / ...). Найди раздел **«Управление DNS»** или **«DNS-записи»** для своего домена.

Добавь две **A-записи**:

| Тип | Имя | Значение | TTL |
|-----|-----|----------|-----|
| A | `@` (или пусто, или сам домен) | `194.58.112.45` (твой IP) | 3600 |
| A | `www` | `194.58.112.45` (тот же IP) | 3600 |

Сохрани. DNS-кеш обновляется обычно за 5–60 минут, реже до суток.

Проверь, что сработало:

```bash
# с твоего сервера или локального компьютера
dig +short mycinema.ru
# должно вывести 194.58.112.45
```

(на Windows: `nslookup mycinema.ru`)

Можно так же открыть `http://mycinema.ru` в браузере — должен показаться сайт (пока ещё без HTTPS).

---

## Шаг 12. HTTPS-сертификат

**Let's Encrypt** выдаёт бесплатные SSL-сертификаты, которые автоматически продлеваются каждые 90 дней. Установщик `certbot` мы уже поставили в [Шаге 5](#шаг-5-установка-нужного-по).

```bash
sudo certbot --nginx -d mycinema.ru -d www.mycinema.ru
```

Ответы:
- Email — твой реальный, на него будут предупреждения о проблемах с сертификатом
- Согласие с TOS — `Y`
- Подписка на рассылку — на твой выбор
- Redirect HTTP → HTTPS — **выбери опцию 2** (Redirect: всех на HTTPS)

Certbot сам подправит конфиг nginx, добавит SSL-секции и поднимет редирект `http → https`.

Проверь:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Открой `https://mycinema.ru` — должен быть зелёный замочек 🔒 в адресной строке.

### Автоматическое продление

Certbot уже добавил cron / systemd timer. Проверим:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

`dry-run` проверяет, что обновление сработает (без реального обновления). Если всё ок — `Congratulations, all simulated renewals succeeded`.

---

## Шаг 13. Финальная проверка

Открой в браузере `https://mycinema.ru`:

1. ✅ Сайт открывается с зелёным замочком HTTPS.
2. ✅ Виден список крыш / фильмов (или приглашение войти).
3. Войди как `owner@mycinema.ru` / `changeme_at_first_login` → должен попросить сделать первичную настройку (новый email + пароль).
4. После настройки на твой email должен прийти 6-значный код подтверждения. Введи его на странице `/verify-email`.
5. Если письмо не пришло — проверь Спам и логи backend:
   ```bash
   sudo journalctl -u roofcinema-backend -n 50 --no-pager | grep -i smtp
   ```

Открой страницу любой крыши с телефона — должна показаться карта со зоной 3 км.

Открой админку, перейди в «Бронирования», создай бронь во втором окне браузера — должна появиться в реал-тайм без обновления страницы (WebSocket работает).

---

## Шаг 14. Бэкапы базы

Раз в день делать дамп PostgreSQL и хранить 14 последних. Иначе в случае поломки можно потерять всё.

```bash
sudo mkdir -p /var/backups/roofcinema
sudo chown postgres:postgres /var/backups/roofcinema
```

Создадим скрипт:

```bash
sudo nano /usr/local/bin/roofcinema-backup.sh
```

```bash
#!/bin/bash
set -e
TS=$(date +%F_%H%M)
OUT="/var/backups/roofcinema/roofcinema_${TS}.sql.gz"
sudo -u postgres pg_dump roofcinema | gzip > "$OUT"
# удаляем бэкапы старше 14 дней
find /var/backups/roofcinema -type f -name '*.sql.gz' -mtime +14 -delete
```

```bash
sudo chmod +x /usr/local/bin/roofcinema-backup.sh
```

Добавим в cron — запуск каждый день в 3 утра:

```bash
sudo crontab -e
```

В конец файла добавь:

```
0 3 * * * /usr/local/bin/roofcinema-backup.sh
```

Сохрани (если nano: Ctrl+O, Enter, Ctrl+X).

Проверь, что скрипт работает прямо сейчас:

```bash
sudo /usr/local/bin/roofcinema-backup.sh
ls -lh /var/backups/roofcinema/
```

Должен появиться файл `roofcinema_2024-...sql.gz`.

### Дополнительно: бэкапы загрузок

В `backend/uploads/` лежат постеры и кадры. Если их потеряешь — фильмы будут без картинок.

```bash
sudo nano /usr/local/bin/roofcinema-uploads-backup.sh
```

```bash
#!/bin/bash
set -e
TS=$(date +%F)
tar czf "/var/backups/roofcinema/uploads_${TS}.tar.gz" \
    -C /home/roofcinema/roofcinema/backend uploads
find /var/backups/roofcinema -type f -name 'uploads_*.tar.gz' -mtime +7 -delete
```

```bash
sudo chmod +x /usr/local/bin/roofcinema-uploads-backup.sh
sudo crontab -e
# добавь:
30 3 * * * /usr/local/bin/roofcinema-uploads-backup.sh
```

### Куда сохранять бэкапы

На самом VPS — рискованно (если сервер упадёт, бэкапы тоже). Лучше:
- Копировать на свой компьютер через `rsync` раз в неделю.
- Или класть в **S3-совместимое хранилище** (Yandex Object Storage, Selectel S3, ~50 ₽/мес за пару гигов).
- Или просто слать дамп себе на email — для совсем маленьких баз.

---

## Шаг 15. Обновление проекта

Когда ты обновляешь код (исправил баг, добавил фичу) — пересобираем фронт и перезапускаем backend.

```bash
ssh roofcinema@194.58.112.45

cd ~/roofcinema
git pull                           # подтянуть свежий код

# обновить backend
cd backend
source .venv/bin/activate
pip install -r requirements.txt   # если зависимости поменялись
sudo systemctl restart roofcinema-backend

# пересобрать фронт
cd ../frontend
npm install                        # если package.json менялся
npm run build
sudo rm -rf /var/www/roofcinema/*
sudo cp -r dist/* /var/www/roofcinema/
sudo chown -R www-data:www-data /var/www/roofcinema

# nginx обычно перезапускать не нужно, но статика обновилась автоматически
```

Лучше сделать скрипт для одной команды:

```bash
nano ~/deploy.sh
```

```bash
#!/bin/bash
set -e
cd ~/roofcinema
git pull

cd backend
source .venv/bin/activate
pip install -q -r requirements.txt

cd ../frontend
npm install --silent
npm run build
sudo rm -rf /var/www/roofcinema/*
sudo cp -r dist/* /var/www/roofcinema/
sudo chown -R www-data:www-data /var/www/roofcinema

sudo systemctl restart roofcinema-backend
echo "✅ Deployed: $(date)"
```

```bash
chmod +x ~/deploy.sh
# теперь обновление — одна команда:
~/deploy.sh
```

---

## Что ещё стоит сделать

### Безопасность

1. **Отключить вход по паролю в SSH** (если настроил ключи в Шаге 4.4):
   ```bash
   sudo nano /etc/ssh/sshd_config
   # найди:    PasswordAuthentication yes
   # поменяй:  PasswordAuthentication no
   # найди:    PermitRootLogin yes
   # поменяй:  PermitRootLogin no
   sudo systemctl restart ssh
   ```

2. **Fail2ban** — банит IP с подбором паролей:
   ```bash
   sudo apt install -y fail2ban
   sudo systemctl enable --now fail2ban
   ```

3. **Регулярные обновления безопасности:**
   ```bash
   sudo apt install -y unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```

### HTTPS-настройки потуже

В `/etc/nginx/sites-available/roofcinema` после `listen 443 ssl` добавь:

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

`sudo nginx -t && sudo systemctl reload nginx`.

Проверь оценку TLS на [SSL Labs](https://www.ssllabs.com/ssltest/analyze.html?d=mycinema.ru) — должен быть A или A+.

### Мониторинг (опционально)

- **[UptimeRobot](https://uptimerobot.com/)** — бесплатно. Пингует сайт каждые 5 минут, шлёт уведомление если упал.
- **[Sentry](https://sentry.io/)** — отлавливает ошибки в Python и React в реальном времени. Free tier до 5000 событий/мес.
- **Логи backend** — `sudo journalctl -u roofcinema-backend -f` (последние с tail-режимом).
- **Логи nginx** — `sudo tail -f /var/log/nginx/roofcinema.error.log`.

### Производительность

- На 2 GB RAM хватит **2 worker'ов uvicorn** (уже стоит в systemd-юните).
- Если будет нагрузка — поставь **Redis** для кеша и для broadcast WebSocket-событий между worker'ами.
- Подключи **CDN** (Yandex Cloud CDN, Cloudflare) для статики, чтобы быстрее грузить на телефонах с медленным интернетом.

### Email — для рабочего проекта

См. [SMTP_GUIDE.md](SMTP_GUIDE.md). Главные мысли:
- Используй свой домен (`noreply@mycinema.ru`), не `@gmail.com`.
- Настрой **SPF, DKIM, DMARC** записи в DNS — иначе письма будут попадать в спам.
- Для серьёзного объёма — UniSender Go, SendPulse или Mailgun.

---

## Если что-то сломалось

### Сайт не открывается

1. DNS пропагнировался? `dig +short mycinema.ru` → должен быть твой IP.
2. nginx работает? `sudo systemctl status nginx`
3. Backend работает? `sudo systemctl status roofcinema-backend`
4. Фаервол не блочит? `sudo ufw status`

### `502 Bad Gateway`

Это значит nginx не достучался до backend.
```bash
sudo journalctl -u roofcinema-backend -n 50 --no-pager
```
Скорее всего ошибка в `.env` или базе.

### `500 Internal Server Error`

Backend стартует, но что-то падает в коде. Тот же `journalctl`.

### Письма не приходят

Логи backend → grep `smtp`:
```bash
sudo journalctl -u roofcinema-backend -n 200 --no-pager | grep -iE "smtp|email"
```

### Сертификат не получается

Чаще всего из-за того, что DNS ещё не пропагнировался. Подожди час и попробуй снова:
```bash
sudo certbot --nginx -d mycinema.ru -d www.mycinema.ru
```

### Кончилось место на диске

```bash
df -h
du -sh /home/* /var/*
```
Чаще всего это логи в `/var/log/journal/` — можно почистить:
```bash
sudo journalctl --vacuum-time=7d
```

### Что-то непонятное — нужна помощь

Скопируй вывод этих команд и приходи с ними:

```bash
sudo systemctl status nginx roofcinema-backend
sudo journalctl -u roofcinema-backend -n 50 --no-pager
sudo nginx -T 2>&1 | tail -50
```

---

## Краткая шпаргалка после развёртывания

```bash
# Подключиться
ssh roofcinema@194.58.112.45

# Логи backend (live)
sudo journalctl -u roofcinema-backend -f

# Перезапустить backend
sudo systemctl restart roofcinema-backend

# Логи nginx
sudo tail -f /var/log/nginx/roofcinema.error.log

# Применить обновление кода
~/deploy.sh

# Доступ к базе
psql -h 127.0.0.1 -U roofcinema -d roofcinema

# Создать ручной бэкап
sudo /usr/local/bin/roofcinema-backup.sh
ls -lh /var/backups/roofcinema/

# Перечитать конфиг nginx
sudo nginx -t && sudo systemctl reload nginx
```

Готово. Сайт работает, домен привязан, HTTPS включён, бэкапы делаются. Можно показывать миру 🎬
