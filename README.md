# Кино на крыше

Веб-приложение для бронирования мест на показах кино на крышах. Тёмная тема в духе Netflix, поддержка ролей `super_admin` / `admin` / `user`, реал-тайм для админов, карта Leaflet/OSM со скрытием точного адреса до оплаты.

## Стек

- **Backend** — Python 3.11+ · FastAPI · SQLAlchemy 2.x · SQLite (dev) / PostgreSQL (prod-ready) · JWT (python-jose) · bcrypt · httpx (для Nominatim/OMDb/Кинопоиск) · WebSocket.
- **Frontend** — React 18 · TypeScript · Vite · React Router · Leaflet (через CDN, без npm-зависимости) · QR через api.qrserver.com.

---

## Быстрый старт

> По умолчанию backend и frontend слушают **только на 127.0.0.1**. Раздел [LAN-тест](#lan-тест-с-телефона--другого-устройства) ниже — как открыть сайт с телефона.

### macOS / Linux

```bash
# 1) Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # отредактируй SECRET_KEY и SUPER_ADMIN_PASSWORD
python scripts/seed_dev.py    # демо-данные: 2 города, 3 крыши, 2 фильма, 4 показа
python run_dev.py             # http://127.0.0.1:8010

# 2) В другом терминале:
cd frontend
npm install
npm run dev                   # http://127.0.0.1:5180
```

### Windows (PowerShell или git-bash)

```powershell
# 1) Backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1            # либо .venv\Scripts\activate.bat для cmd
pip install -r requirements.txt
copy .env.example .env
python scripts\seed_dev.py
python run_dev.py

# 2) В другом терминале:
cd frontend
npm install
npm run dev
```

**Стандартный владелец** (из `.env`): логин `owner@roofcinema.app` / пароль `changeme123`. **При первом входе backend заставит указать свой настоящий email и придумать новый пароль** — после этого нужно подтвердить email кодом из письма (если SMTP не настроен — код напечатается в консоли backend).

---

## LAN-тест с телефона / другого устройства

Чтобы открыть сайт с телефона в той же Wi-Fi сети:

1. **Узнай IP-адрес компьютера** в локальной сети:
   ```bash
   # macOS / Linux:
   ipconfig getifaddr en0          # macOS, обычно Wi-Fi
   # или:
   python backend/scripts/find_lan_ip.py
   ```
   ```powershell
   # Windows:
   ipconfig                          # ищем "IPv4-адрес" в строке Wi-Fi
   ```
   Получишь что-то вроде `192.168.1.42`.

2. **Запусти frontend в LAN-режиме:**
   ```bash
   cd frontend
   npm run dev:lan                   # = vite --host 0.0.0.0
   ```
   Vite сам напишет адрес: `Network: http://192.168.1.42:5180/`.

3. **Backend остаётся на 127.0.0.1** — Vite-прокси перенаправит `/api/...` и WebSocket с устройства в локальный backend. **Запускать backend на 0.0.0.0 не нужно.** (Если всё-таки хочется: `python run_dev.py --lan`.)

4. **Открой `http://192.168.1.42:5180` на телефоне.** Работают:
   - все страницы (главная, фильм, крыша, профиль, билеты),
   - бронирование,
   - WebSocket-обновления для админа,
   - загрузка изображений (постеры, кадры, аватары),
   - QR-коды билетов.

> **Брандмауэр.** macOS при первом запуске спросит «Разрешить входящие подключения для node» — нажми «Разрешить». Windows может спросить про Public/Private сеть — выбирай Private (домашняя Wi-Fi).
>
> **HTTPS.** Для теста по HTTP всё работает. Установить как PWA на iPhone нельзя без HTTPS — это нормально, PWA-установка появится после деплоя за TLS.

---

## Отправка писем (email-подтверждение и сброс пароля)

При регистрации генерируется 6-значный код подтверждения email. При запросе сброса пароля — ссылка с одноразовым токеном (живёт 1 час).

**Без SMTP (dev-режим)** — письма выводятся в **консоль backend** с пометкой `[DEV-EMAIL]`. Просто скопируй код / ссылку из терминала где запущен uvicorn.

**С реальным SMTP** — заполни в `backend/.env`:
```env
SMTP_HOST=smtp.yandex.ru          # или smtp.gmail.com, smtp.mail.ru
SMTP_PORT=587
SMTP_USER=mail@yourdomain.ru
SMTP_PASSWORD=пароль_приложения   # для Yandex/Gmail — пароль приложения, не основной
SMTP_FROM=noreply@yourdomain.ru
SMTP_USE_TLS=true
APP_BASE_URL=http://127.0.0.1:5180  # используется в ссылках восстановления
```
После изменения `.env` перезапусти backend.

**📦 Развёртывание на сервере (от VPS до HTTPS):** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — пошаговый гайд для новичка: где заказать сервер, как купить домен, что установить, PostgreSQL, nginx, systemd, Let's Encrypt, бэкапы. Всё от и до.

**📖 Подробный гайд по всем провайдерам с лимитами:** [docs/SMTP_GUIDE.md](docs/SMTP_GUIDE.md) — Yandex 360, Mail.ru, UniSender, SendPulse, Gmail, SendGrid, Mailgun, Postmark, Amazon SES + рекомендации какой сервис под какой объём + защита от спама (SPF/DKIM/DMARC).

**Быстрые ссылки на популярные:**
- **Яндекс 360**: `smtp.yandex.ru:587`, [создать пароль приложения](https://id.yandex.ru/security/app-passwords) → 500 писем/день.
- **UniSender Go**: 100 писем/день бесплатно, российский, без VPN.
- **Mailgun**: 5000 писем первые 3 месяца, потом $35/мес → для продакшена.

## Опциональные внешние API

Если хочешь, чтобы при добавлении фильма данные подтягивались автоматически (постер, описание, рейтинги IMDb/Кинопоиска), добавь хотя бы один ключ в `backend/.env`:

- **OMDb** (на базе IMDb, 1000 запросов в день бесплатно):
  https://www.omdbapi.com/apikey.aspx → Free → email → ссылка из письма.
  ```
  OMDB_API_KEY=твой_ключ
  ```
- **Кинопоиск Unofficial** (русские названия, постеры, оба рейтинга):
  https://kinopoiskapiunofficial.tech/ → «Получить API ключ».
  ```
  KINOPOISK_API_KEY=твой_ключ
  ```

После добавления ключа — перезапусти backend. Без ключей UI предложит заполнить данные о фильме вручную.

Геокодер (подсказки городов и адресов при создании города/крыши) уже работает «из коробки» через OpenStreetMap Nominatim — **ключ не нужен**.

---

## Что есть в проекте

### Публичные страницы
- `/` — афиша. Селектор города с поиском, фильтр **сегодня / неделя / месяц** с навигацией стрелками. Если залогинен — показываются фильмы домашнего города.
- `/movies/:id` — карточка фильма: постер слева (sticky), справа описание и **ближайшие показы**. Под этим — встроенный трейлер (YouTube / Rutube) и горизонтальная карусель кадров.
- `/rooftops/:id` — карточка крыши: название, город, описание. **Карта с размытой зоной 5 км** (центр круга случайно сдвинут на 1.5–2.5 км от реального адреса). Точный адрес и маркер раскрываются по кнопке только для админов крыши и пользователей с оплаченной бронью.
- `/login`, `/register` — обе принимают `?next=...` и возвращают на исходную страницу после входа.

### Профиль (пользователь)
- `/profile` — аватар, ФИО, баланс, баннер «Email не подтверждён» если нужно, кнопки в «Бронирования», «Оплаченные брони (билеты)» и «Безопасность».
- `/profile/edit` — правка ФИО, телефона, соцсети, описания, загрузка аватара.
- `/profile/security` — изменить пароль, список **активных сессий** (с UA + IP), завершить любую сессию или сразу все кроме текущей.
- `/profile/tickets` — Apple-Wallet-карточки билетов. Свёрнуто — фильм, дата, адрес; раскрыто — QR-код + 6-значный код для ручной проверки.
- `/bookings` — все брони с таймером для `waiting_payment` и историей.
- `/bookings/:id` — большой таймер обратного отсчёта, состав брони, **реквизиты перевода** (из шаблона показа), **частичная оплата с баланса** (слайдер от 0 до доступной суммы), отмена.
- `/verify-email` — 6 квадратиков PIN-инпута для кода с почты, кнопка «Отправить повторно» с обратным отсчётом 60 секунд.
- `/forgot-password` / `/reset-password?token=...` — сброс пароля по email.

### Админ-панель (`/admin`)
- **Города** — добавление с автодополнением (Nominatim), часовой пояс из 11 российских, удаление с проверкой зависимостей.
- **Крыши** — создание с автодополнением адреса (Nominatim → подставляет lat/lng), редактирование (`/admin/rooftops/:id`), управление **типами мест** на крыше (название, цена, количество; soft-delete если используется в показах), invite-ссылки для администраторов крыши.
- **Фильмы** — поиск в локальной базе + OMDb + Кинопоиск; новый фильм через мастер (название → найти → использовать / заполнить вручную); правка всех полей; **загрузка постера и кадров** в `backend/uploads/`.
- **Показы** — фильм + крыша + дата/время + типы мест с переопределяемой ценой и количеством для этого показа + выбор шаблона реквизитов.
- **Бронирования** — фильтр по показу/статусу/поиску ФИО · email · коду; **real-time через WebSocket** (новые брони появляются без F5); действия: продлить таймер, пометить оплаченным, перенести на другой показ (с проверкой совместимости типов мест), вернуть на баланс пользователя, отменить.
- **Реквизиты** — шаблоны для оплаты переводом (получатель, карта, телефон СБП, банк); один помечается «по умолчанию» — подставляется в новые показы.
- **Invite-ссылки** — `/invite/:token` принимает приглашение и делает пользователя админом крыши.

### Безопасность и приватность
- JWT в `Authorization: Bearer` с уникальным `jti` для каждой сессии. Сессии хранятся в БД (`UserSession`) — при завершении сессии токен сразу перестаёт работать.
- bcrypt для паролей.
- Email-подтверждение: 6-значный код с TTL 10 минут, лимит 60 секунд между переотправками, до 6 попыток ввода.
- Сброс пароля: одноразовый токен в email, ссылка живёт 1 час, после сброса **все сессии этого пользователя инвалидируются**.
- 152-ФЗ: согласие на обработку ПДн обязательно при регистрации и при создании брони.
- Адреса крыш скрываются: всегда показывается **примерная зона радиусом 3 км** на карте, центр зоны детерминированно смещён на 1.5–2.5 км от реального адреса. Текстовый адрес раскрывается только админам и пользователям с оплаченной бронью.
- WebSocket требует JWT в query-параметре, права проверяются по `RooftopAdmin.can_manage_bookings`.
- Email пользователя уникален (DB constraint + проверка на регистрации).

---

## Прогресс по фазам

- [x] **Фаза 1**: скелет, JWT-auth, роли, города, крыши, invite-ссылки админов
- [x] **Фаза 2**: каталог фильмов, главная с фильтрами даты / выбором города с поиском, страница крыши с картой
- [x] **Фаза 3**: страница фильма, бронирование с таймером, оплата с баланса
- [x] **Фаза 4**: профиль с аватаром, Apple-Wallet-карточки билетов с QR, **email-верификация с PIN-инпутом**, **безопасность (смена пароля, сброс по email, активные сессии)**
- [ ] **Фаза 5**: оплата переводом с загрузкой чека + подтверждение администратором (баланс и шаблоны реквизитов уже готовы)
- [x] **Фаза 6** (частично): админ-вкладки, поиск Kinopoisk/OMDb, типы мест, проверка трейлеров
- [x] **Фаза 7** (частично): админ-бронирования, перенос, возврат на баланс, продление таймера
- [x] **Фаза 8** (частично): WebSocket real-time админ-бронирований; проверка билетов на входе — TODO
- [ ] **Фаза 9**: PWA-манифест + service worker + финальный дизайн + правила 152-ФЗ

---

## Структура проекта

```
backend/
  app/
    main.py              # точка входа FastAPI
    config.py            # настройки (.env)
    db.py                # SQLAlchemy: Base, SessionLocal, engine
    models.py            # модели: User, City, Rooftop, SeatType, Movie, Screening, Booking, ...
    schemas.py           # Pydantic-схемы для всех роутеров
    security.py          # bcrypt + JWT
    deps.py              # FastAPI deps (текущий пользователь, проверки ролей)
    ws_manager.py        # in-process WebSocket broadcaster
    utils.py             # slugify, RU_TIMEZONES
    routers/
      auth.py            # /api/auth: register, login, logout, verify-email, forgot/reset-password
      users.py           # /api/users/me, sessions, change-password
      email_service.py   # SMTP отправка с фолбэком на консоль
      cities.py          # CRUD + dependents + /timezones
      rooftops.py        # CRUD + seat-types + invites + публичная карточка
      seat_types.py      # CRUD типов мест на крыше
      movies.py          # CRUD + stills
      movie_search.py    # /api/movies/external-search (OMDb + Кинопоиск + локально)
      screenings.py      # CRUD + seat_allocations + payout_template
      bookings.py        # создание, отмена, продление, перенос, оплата, возврат
      payout_templates.py# шаблоны реквизитов
      uploads.py         # /api/uploads/image
      geocode.py         # Nominatim proxy для городов и адресов
      ws.py              # /api/ws/screenings/{id}/bookings
  scripts/
    seed_dev.py          # демо-данные
    find_lan_ip.py       # утилита для LAN-теста
  run_dev.py             # кросс-платформенный запускатор
  uploads/               # сохранённые изображения (статика)

frontend/
  src/
    api.ts               # fetch + типы
    auth.tsx             # AuthProvider
    App.tsx              # роуты
    components/          # ImageUpload, Autocomplete, CitySelector, DateFilter, LeafletMap, Rating, BookingForm, TicketCard
    pages/
      HomePage, MoviePage, RooftopPage, ProfilePage, EditProfilePage, TicketsPage,
      MyBookingsPage, BookingPage, LoginPage, RegisterPage, AcceptInvitePage
      admin/
        AdminLayout, CitiesAdmin, RooftopsAdmin, RooftopAdmin,
        MoviesAdmin, MovieAdmin, ScreeningsAdmin, BookingsAdmin, PayoutTemplatesAdmin
    lib/                 # bookingStatus (parseUtc + countdown), embed (YT/Rutube), hooks, useBookingsWs
    styles.css           # темная тема, Apple Wallet, админ-таблица
  vite.config.ts         # порт 5180, proxy /api (с WS) + /uploads → 127.0.0.1:8010
```

---

## Полезные команды

```bash
# Сбросить демо-данные (удаляет всё кроме super_admin)
python backend/scripts/seed_dev.py

# Узнать LAN IP для теста с телефона
python backend/scripts/find_lan_ip.py

# Запустить backend в LAN-режиме (на всякий)
python backend/run_dev.py --lan

# Сборка фронта на продакшен
cd frontend && npm run build && npm run preview
```

## Известные ограничения dev-окружения

- Развёртывание на одном процессе uvicorn — WebSocket-broadcast только внутри процесса. Под несколько worker'ов понадобится Redis pub/sub.
- SQLite не любит частые ALTER. При изменении моделей в dev проще удалить `roofcinema.db` и пересоздать через `seed_dev.py` (на проде использовать Alembic).
- Часовые пояса показов: `starts_at` хранится как наивная локальная датавремя крыши. Если пользователь и крыша в разных TZ, отображение времени упрощённое (берётся локальная TZ браузера). Чистый фикс — Phase 9.
# roofcinema
