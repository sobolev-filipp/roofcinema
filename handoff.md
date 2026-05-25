# Handoff: «Кино на крыше» (RoofCinema)

Документ для продолжения проекта в новой сессии Claude. Содержит полное описание состояния, архитектуры, текущих задач и нерешённых проблем.

---

## 1. О проекте

**Цель:** PWA для бронирования мест на показах кино на крышах в России. Пользователь выбирает город → фильм → показ на конкретной крыше → бронирует место → оплачивает → получает QR-билет.

**Аудитория:** Россия. Тёмная тема в духе Netflix. Должно работать как сайт и как устанавливаемое PWA (Фаза 9).

**Папка проекта:** `F:\Проекты\RoofCinema` (Windows-машина пользователя).

**Доступ дефолтного владельца** (для dev): `owner@roofcinema.app` / `changeme123`. При первом входе forced первичная настройка email+пароля.

**Тестовый VPS** (из DEPLOYMENT.md, уже арендован пользователем):
- Host: `93.88.203.172`
- root password: `C9RgYEfdhVWgx`
- Пользователь `roofadmin`, пароль `33774Dancom`

---

## 2. Стек

### Backend
- **Python 3.11+** (тестировано на 3.13 на машине пользователя)
- **FastAPI** + **uvicorn**
- **SQLAlchemy 2.x** ORM
- **SQLite** в dev, **PostgreSQL** в проде
- **JWT** через `python-jose`, привязанный к `UserSession.jti` в БД для возможности отозвать сессию
- **bcrypt** прямо (без passlib — конфликт с новым bcrypt)
- **httpx** для прокси к Nominatim/OMDb/Кинопоиску
- **WebSocket** для реал-тайма (in-process broadcaster, не Redis)
- **SMTP** для писем (Gmail / Yandex / любой SMTP) + fallback в консоль с пометкой `[DEV-EMAIL]`

### Frontend
- **React 18** + **TypeScript**
- **Vite 5** + **React Router**
- Без UI-библиотек — собственная дизайн-система через CSS-переменные
- **Leaflet через CDN** (не npm-зависимость) для карты крыши
- **QR-код через api.qrserver.com** (без npm-библиотеки)
- Mobile-first responsive дизайн с бургер-меню

### Внешние API (опциональные)
- **Kinopoisk Unofficial API** + **OMDb** — поиск фильмов
- **Nominatim (OpenStreetMap)** — геокодер городов и адресов (без ключа)
- **api.qrserver.com** — рендеринг QR-кодов

---

## 3. Структура папок

```
F:\Проекты\RoofCinema\
├── README.md                    # быстрый старт
├── handoff.md                   # этот файл
├── docs\
│   ├── DEPLOYMENT.md            # инструкция по деплою на VPS (≈700 строк)
│   └── SMTP_GUIDE.md            # настройка email (Yandex/Gmail/SendPulse/...)
├── backend\
│   ├── .env                     # production-like настройки (SMTP, OMDb, Кинопоиск)
│   ├── .env.example             # шаблон
│   ├── requirements.txt
│   ├── roofcinema.db            # SQLite dev-БД (можно удалять и пересоздавать через seed_dev.py)
│   ├── run_dev.py               # кросс-платформенный запуск (Windows + macOS)
│   ├── uploads\                 # сюда сохраняются постеры/кадры/аватары
│   ├── scripts\
│   │   ├── seed_dev.py          # пересоздаёт демо-данные
│   │   └── find_lan_ip.py       # для теста с телефона
│   └── app\
│       ├── main.py              # точка входа FastAPI, mount /uploads, lifespan
│       ├── config.py            # pydantic-settings (.env)
│       ├── db.py                # engine, Base, get_db
│       ├── models.py            # ВСЕ модели в одном файле
│       ├── schemas.py           # ВСЕ Pydantic-схемы
│       ├── security.py          # bcrypt + JWT с jti
│       ├── deps.py              # get_current_user, role guards, session check
│       ├── email_service.py     # SMTP + DEV-fallback
│       ├── ws_manager.py        # WebSocket-broadcaster (in-process)
│       ├── utils.py             # slugify, RU_TIMEZONES
│       └── routers\
│           ├── auth.py          # /register /login /me /verify-email /forgot-password
│           ├── users.py         # /me /change-password /sessions /initial-setup
│           ├── cities.py        # CRUD + /dependents + /timezones
│           ├── rooftops.py      # CRUD + публичная карточка с скрытым адресом
│           ├── seat_types.py    # типы мест на крыше
│           ├── movies.py        # CRUD + stills
│           ├── movie_search.py  # /external-search (OMDb + KP + local)
│           ├── screenings.py    # CRUD с payout_template_id и seat_allocations
│           ├── bookings.py      # создание/отмена/продление/перенос/баланс
│           ├── payout_templates.py
│           ├── uploads.py       # POST /api/uploads/image
│           ├── geocode.py       # Nominatim proxy
│           └── ws.py            # /api/ws/screenings/{id}/bookings
└── frontend\
    ├── package.json             # npm scripts: dev, dev:lan, build
    ├── vite.config.ts           # proxy /api (с WS) + /uploads → 127.0.0.1:8010
    └── src\
        ├── main.tsx
        ├── App.tsx              # роуты + SetupGuard для force initial-setup
        ├── api.ts               # fetch wrapper + ВСЕ TypeScript-типы
        ├── auth.tsx             # AuthProvider, useAuth
        ├── styles.css           # дизайн-система с CSS-переменными
        ├── components\
        │   ├── Header.tsx       # с бургером и mobile drawer
        │   ├── BookingForm.tsx  # на странице фильма
        │   ├── BalancePaymentBox.tsx  # частичная оплата с баланса
        │   ├── TicketCard.tsx   # Apple Wallet карточка с QR
        │   ├── PinInput.tsx     # 6-значный код для email-верификации
        │   ├── ImageUpload.tsx  # для постера + аватара
        │   ├── Autocomplete.tsx # для города/адреса
        │   ├── CitySelector.tsx
        │   ├── DateFilter.tsx   # Сегодня/Неделя/Месяц + стрелки
        │   ├── LeafletMap.tsx   # CDN-загрузка Leaflet
        │   └── Rating.tsx
        ├── pages\
        │   ├── HomePage.tsx     # афиша
        │   ├── MoviePage.tsx    # карточка фильма
        │   ├── RooftopPage.tsx  # с картой 3км
        │   ├── ProfilePage.tsx  # с баннером верификации + ссылками
        │   ├── EditProfilePage.tsx
        │   ├── SecurityPage.tsx # смена пароля + список сессий
        │   ├── TicketsPage.tsx  # Apple Wallet карточки билетов
        │   ├── MyBookingsPage.tsx
        │   ├── BookingPage.tsx  # детали брони с таймером
        │   ├── VerifyEmailPage.tsx     # PIN-инпут + таймер resend
        │   ├── ForgotPasswordPage.tsx
        │   ├── ResetPasswordPage.tsx
        │   ├── InitialSetupPage.tsx    # forced для дефолтного владельца
        │   ├── LoginPage.tsx
        │   ├── RegisterPage.tsx
        │   ├── AcceptInvitePage.tsx
        │   └── admin\
        │       ├── AdminLayout.tsx     # 6 табов
        │       ├── CitiesAdmin.tsx
        │       ├── RooftopsAdmin.tsx
        │       ├── RooftopAdmin.tsx    # детальная страница с CRUD seat-types и invites
        │       ├── MoviesAdmin.tsx
        │       ├── MovieAdmin.tsx      # с external search + stills upload
        │       ├── ScreeningsAdmin.tsx
        │       ├── BookingsAdmin.tsx   # с табами Актуальные/Завершенные
        │       └── PayoutTemplatesAdmin.tsx
        └── lib\
            ├── bookingStatus.ts        # parseUtc(), msUntil(), statuses
            ├── embed.ts                # YouTube/Rutube → embed URL
            ├── useBookingsWs.ts        # WebSocket hook
            └── hooks.ts                # useDebouncedValue
```

---

## 4. Прогресс по фазам (изначальный план был 9 фаз)

- [x] **Фаза 1**: скелет, JWT-auth, роли (super_admin / admin / user), города, крыши, invite-ссылки админов.
- [x] **Фаза 2**: каталог фильмов, главная с фильтрами даты, селектор города с поиском, страница крыши с картой Leaflet (зона 3км).
- [x] **Фаза 3**: страница фильма, бронирование с таймером, частичная оплата с баланса.
- [x] **Фаза 4**: профиль с аватаром, Apple-Wallet билеты с QR, **email-верификация PIN-инпутом**, **безопасность (смена пароля, сброс по email, активные сессии)**.
- [ ] **Фаза 5**: оплата переводом с загрузкой чека + админ-подтверждение. **← СЛЕДУЮЩАЯ**
- [x] **Фаза 6** (частично): админ-вкладки, поиск Kinopoisk/OMDb, типы мест, проверка трейлеров. Не сделано: проверка работоспособности ссылки на трейлер (кнопка «проверить»).
- [x] **Фаза 7** (частично): админ-бронирования, перенос, возврат на баланс, продление таймера. Не сделано: страница пользователя с полной историей (history, balance, social ссылки) при клике на ФИО из админ-броней.
- [x] **Фаза 8** (частично): WebSocket real-time админ-бронирований. Не сделано: **проверка билетов на входе по QR/коду** (отдельный экран сканера для администраторов).
- [ ] **Фаза 9**: PWA-манифест + service worker + финальный полировка + правила 152-ФЗ (политика конфиденциальности).

Дополнительные волны изменений (не в плане):
- [x] **Wave A**: шаблоны реквизитов, баланс, WS-реалтайм
- [x] **Redesign**: дизайн-система с CSS-переменными, mobile-first, бургер с анимацией
- [x] **Wave B**: UI правки + partial balance + email + sessions/password + force initial-setup
- [x] Документация деплоя на VPS + SMTP-гайд

---

## 5. Архитектура: ключевые решения

### Аутентификация
- JWT с `jti` claim → `UserSession` в БД. `get_current_user` ищет сессию, проверяет `revoked_at`. Это позволяет «выйти со всех устройств» инвалидировать конкретные сессии.
- Дефолтный владелец из `.env` создаётся с флагом `requires_initial_setup`. Frontend `<SetupGuard>` редиректит на `/initial-setup` пока флаг не снят.
- Email-верификация: 6-значный код в таблице `EmailVerification`, кулдаун 60с между отправками, 10 минут TTL, до 6 попыток.

### Бронирование
- `Screening.seats` = `ScreeningSeatType` (снапшоты типов мест с возможностью переопределить цену/количество на конкретный показ).
- `Booking.items` = `BookingItem` со снапшотом `name` + `price_each` (чтобы пережить изменение типа места на крыше).
- При отмене типа места на крыше: если он используется в показах — **soft delete** (`is_active=false`), исторические показы сохраняют его.
- При переносе брони на другой показ: ищем у целевого показа `ScreeningSeatType` с тем же `name` — если совпадение и хватает мест → переносим.
- Авто-истечение: на каждом `GET /api/bookings/me` или `/{id}` метод `_expire_overdue` переводит просроченные `waiting_payment` в `expired`.

### Адреса крыш — privacy
- Точные `lat/lng` отдаются только если у пользователя есть оплаченная бронь на эту крышу ИЛИ он админ крыши.
- Для остальных backend сдвигает координаты на 1.5–2.5 км в детерминированно случайном направлении (sha256(roofcinema-{id})) и говорит «зона радиусом 3км».
- Frontend всегда рисует круг 3км без маркера (даже для тех, кто может видеть адрес — адрес отображается текстом под картой).

### Реалтайм
- `app/ws_manager.py` — простой in-process broadcaster, комнаты `screening:{id}`.
- `routers/bookings.py::_broadcast()` шлёт `created`/`updated` события при любых изменениях через `asyncio.ensure_future`.
- Frontend `lib/useBookingsWs.ts` подключается с JWT в query, при любом событии → reload.
- ⚠️ **Если backend запущен с `--workers > 1`** — WS работать не будет, потому что broadcaster в памяти одного процесса. Для прода с несколькими worker'ами нужен Redis pub/sub.

### Внешние API
- OMDb: `https://www.omdbapi.com/?apikey=KEY&s=q`
- Kinopoisk Unofficial: `kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=q` (header `X-API-KEY`)
- Nominatim: без ключа, `nominatim.openstreetmap.org/search?...`, кэш 5 мин в `routers/geocode.py`
- Все три проксируются через backend, кэширование на сервере. Frontend никогда не дёргает их напрямую.

### Email
- `app/email_service.py::send_email()` — если `SMTP_HOST` пустой, печатает в консоль с `[DEV-EMAIL]`. Иначе шлёт через `smtplib`.
- В `.env` пользователя сейчас настроен Gmail (`cinema.on.the.roof.tomsk.70@gmail.com`). Письма уходят, но на mail.ru попадают в **спам** — это нормально для Gmail-отправителя без SPF/DKIM на собственном домене. Решение в проде: свой домен + Yandex 360 / SendPulse.

---

## 6. Известные проблемы (НЕ исправлены)

### 6.1. Чёрное название фильма в админ-бронированиях
В админ-разделе бронирований (`/admin/bookings`) название фильма выводится **чёрным** цветом, должно быть белым. Скорее всего где-то в `BookingsAdmin.tsx` есть inline style или классу не хватает цвета.

**Где смотреть:** `frontend/src/pages/admin/BookingsAdmin.tsx`. Возможно в выводе `selectedScreening.movie.title` или в строках таблицы. Проверить вычисленный цвет через DevTools — какое правило задаёт чёрный.

**Гипотеза:** `<h3>` или `<span>` где выводится title наследует `color` от родителя, а у того явно задан тёмный цвет. Либо `.sp-title` / `.abt-row` использует `color: inherit` от элемента с тёмным фоном. Проверь:
```css
.abt-row > span { background: var(--bg-card); padding: ... }
```
и убедись что text-color наследует `var(--text)` корректно.

### 6.2. Реал-тайм бронирований не работает у пользователя
Пользователь сообщил: «при бронировании в разделе бронирования данные появляются только после перезагрузки страницы». То есть **WebSocket не доставляет события**.

**Проверить:**

1. **Vite-прокси для WS** в `frontend/vite.config.ts`:
   ```ts
   "/api": { target: "http://127.0.0.1:8010", ws: true, changeOrigin: true }
   ```
   Флаг `ws: true` обязателен.

2. **`useBookingsWs.ts`** — token подставляется в query:
   ```ts
   const url = `${proto}//${window.location.host}/api/ws/screenings/${screeningId}/bookings?token=${token}`;
   ```

3. **WS-комната `screening:{id}`** в `ws.py` создаётся правильно, и broadcast в `bookings.py::_broadcast` вызывается.

4. **Главная гипотеза**: `_broadcast` использует `asyncio.get_event_loop()` — в синхронных handler'ах FastAPI может не быть running loop, и broadcast тихо игнорируется. Нужно либо сделать роутеры `async def`, либо использовать `anyio.from_thread.run_sync` или просто bg-task через `BackgroundTasks`.

**Минимальный фикс:** в `bookings.py::_broadcast` обернуть в `try/except` и логировать. Если будет видно «no running loop» — переделать broadcast через FastAPI `BackgroundTasks`:
```python
def create_booking(payload, db, user, bg: BackgroundTasks = ...):
    ...
    bg.add_task(manager.broadcast_sync, f"screening:{screening_id}", payload)
```

Или сделать все booking-routes `async def` (это не сильно ломает остальное, но потребует `db: Session` через `Depends`).

**Альтернатива для проверки**: открыть `chrome://websockets-internals` или DevTools → Network → WS — посмотреть, подключается ли клиент к `/api/ws/screenings/{id}/bookings`. Если в Network тип «websocket» висит с зелёным статусом и есть `messages` — backend шлёт, но клиент не реагирует. Если соединение красное (401/403) — права проверки в `ws.py::_can_view_screening_bookings` отсекают.

### 6.3. PostgreSQL на сервере: пользователь roofadmin создал базу с владельцем `roofcinema` (опечатка)
В DEPLOYMENT.md пользователь выполнил:
```sql
CREATE USER roofadmin WITH PASSWORD '...';
CREATE DATABASE roofcinema OWNER roofcinema;
GRANT ALL PRIVILEGES ON DATABASE roofcinema TO roofcinema;
```
Здесь две ошибки: пользователь `roofcinema` не создан (создан `roofadmin`), но база создана с владельцем `roofcinema`. Чтобы починить:
```sql
sudo -u postgres psql
DROP DATABASE roofcinema;
DROP USER IF EXISTS roofcinema;
-- если хочешь привязать к roofadmin:
ALTER DATABASE roofcinema OWNER TO roofadmin;
-- или просто пересоздать:
CREATE DATABASE roofcinema OWNER roofadmin;
GRANT ALL PRIVILEGES ON DATABASE roofcinema TO roofadmin;
\q
```
Соответственно в `.env` на сервере: `DATABASE_URL=postgresql+psycopg2://roofadmin:ПАРОЛЬ@127.0.0.1:5432/roofcinema`.

### 6.4. Часовые пояса показов
`Screening.starts_at` хранится как наивная `DateTime` — трактуется как «локальное время на крыше». Frontend `new Date(iso)` парсит как локальное время браузера. Если пользователь и крыша в разных TZ, время будет некорректно отображаться. **Не исправлено**, описано в README. Решение: либо хранить с TZ-aware (PostgreSQL `TIMESTAMP WITH TIME ZONE`), либо использовать `Intl.DateTimeFormat({timeZone: rooftop.city.timezone})`.

### 6.5. Backend.utcnow() deprecated в Python 3.12+
В `models.py::utcnow()` используется `datetime.utcnow()` — Python 3.12+ предупреждает что это deprecated. Стоит заменить на:
```python
from datetime import datetime, timezone
def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
```

### 6.6. WatchFiles + Windows + кириллица в пути
На Windows-машине пользователя путь `F:\Проекты\RoofCinema` содержит кириллицу. uvicorn `--reload` иногда не подхватывает изменения и приходится перезапускать backend вручную. Не блокер, но раздражает.

### 6.7. `app/security.py` — `import secrets` дублируется
В файле `secrets` импортируется один раз вверху, но в `routers/auth.py` тоже. Проверить — не должно быть конфликтов.

---

## 7. Следующая фаза: Фаза 5 — оплата переводом + чеки

### Что нужно сделать

**Backend:**

1. Модель `PaymentReceipt`:
   - `id`, `booking_id` (FK), `image_url` (загруженный чек), `status` (`pending`, `approved`, `rejected`), `rejection_reason`, `uploaded_at`, `reviewed_at`, `reviewed_by_id` (FK users).
2. Endpoint `POST /api/bookings/{id}/upload-receipt` (для текущего пользователя):
   - Принимает file (multipart) или url (если уже загружен через `/api/uploads/image`).
   - Создаёт `PaymentReceipt(status=pending)`.
3. Endpoint `GET /api/admin/receipts?status=pending` — список чеков на модерацию.
4. Endpoint `POST /api/admin/receipts/{id}/approve` — статус брони → `paid`, чек → `approved`.
5. Endpoint `POST /api/admin/receipts/{id}/reject` body `{reason}` — статус брони остаётся `waiting_payment`, чек → `rejected`. Пользователь увидит причину и сможет залить новый чек.
6. Уведомление по email пользователю при approve/reject.

**Frontend:**

1. На `/bookings/{id}` (когда статус = `waiting_payment` и баланс не покрывает) — после реквизитов добавить блок «Загрузка чека»:
   - Кнопка «Загрузить чек об оплате» (file input).
   - Превью загруженного.
   - Если уже есть `PaymentReceipt` со статусом `pending` — «Ваш чек на проверке, ожидайте подтверждения».
   - Если статус `rejected` — показать `rejection_reason` и кнопку «Загрузить новый чек».
2. Новая вкладка админ-панели `/admin/receipts`:
   - Список pending-чеков с миниатюрой, ФИО, фильмом, суммой, кнопками «Подтвердить» / «Отклонить» (с обязательной причиной для reject).
3. WebSocket: при approve/reject через broadcast обновлять страницу `/bookings/{id}` у пользователя.

**Email-шаблоны** (добавить в `email_service.py`):
- `send_payment_approved(email, booking_info)` — «Оплата подтверждена, ваш билет готов».
- `send_payment_rejected(email, booking_info, reason)` — «Оплата не подтверждена, причина: …»

### Связанные доработки
- В `Booking` добавить связь с активным `PaymentReceipt` (или просто `relationship(..., order_by=desc(...))` без явной колонки).
- Добавить логику: при approve чека → списать `balance_used` тоже? Или это уже учтено заранее? Нужно решить — наверное чек подтверждает только оставшуюся сумму (`total_amount - balance_used`).

---

## 8. После Фазы 5: оставшиеся фазы

### Фаза 6: завершить
- ✏️ Кнопка «Проверить трейлер» рядом с полем URL в админ-форме фильма — проверяет что YouTube/Rutube embed грузится (можно через `HEAD`-запрос или `<iframe>`+timeout).

### Фаза 7: страница пользователя для админа
- Сейчас в админ-бронированиях клик по ФИО ведёт на `/bookings/{id}` — клиентскую страницу брони. Нужно отдельную **админ-страницу пользователя** `/admin/users/{id}`:
  - История бронирований (все, не только активные).
  - Баланс с возможностью изменения админом.
  - Кнопка «Вернуть деньги на баланс».
  - История транзакций с балансом.
  - Соцсети для контакта.
- Endpoint `GET /api/admin/users/{id}` с расширенной информацией.

### Фаза 8: проверка билетов
- Страница `/admin/check-tickets` для админов на входе.
- QR-сканер через `html5-qrcode` или WebRTC + `BarcodeDetector` API.
- Поле для ручного ввода 6-значного `short_code` (на случай если QR не считывается).
- При успешной проверке → `Booking.status = attended`, `attended_at = now`.
- Если бронь уже `attended` — показать «Уже посещал» (защита от двойного использования).
- Endpoint `POST /api/bookings/check-in` body `{qr_token | short_code}` для админа крыши.

### Фаза 9: PWA + 152-ФЗ + дизайн-полировка
- `vite-plugin-pwa` или ручной service worker + manifest.
- Иконки 192×192 и 512×512.
- Offline-fallback для статики (главная + страницы профиля).
- Страница `/privacy` с политикой конфиденциальности (152-ФЗ).
- Аудит UI на согласованность (отступы, тени, типографика).
- Lighthouse audit, цель 90+ по всем метрикам.

---

## 9. Полезное при возврате к проекту

### Как запустить локально
```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate     # Windows
# или: source .venv/bin/activate   # mac/linux
pip install -r requirements.txt
cp .env.example .env
python scripts/seed_dev.py
python run_dev.py           # http://127.0.0.1:8010

# Frontend
cd frontend
npm install
npm run dev                 # http://127.0.0.1:5180
# или для теста с телефона:
npm run dev:lan             # 0.0.0.0:5180
```

### Сброс БД (если изменил модели)
```bash
# Windows
del backend\roofcinema.db
# мак/линукс
rm backend/roofcinema.db
# перезапустить backend — БД пересоздастся
python backend/scripts/seed_dev.py  # добавит демо-данные
```

### Дефолтный владелец после reset DB
- `owner@roofcinema.app` / `changeme123` → форсит initial setup.

### Тестовые пользователи (создаются seed-скриптом):
- Сейчас seed создаёт только города/крыши/фильмы/показы, но **не** пользователей. Регистрация — вручную через UI.

### Проверка SMTP
```bash
cd backend
.venv\Scripts\python.exe -c "
from app.email_service import send_email
send_email('test@example.com', 'Тест', 'Тестовое письмо')
"
```
В консоли увидишь либо `[DEV-EMAIL]` (если SMTP_HOST пуст в .env), либо реальную отправку.

### Где смотреть логи

- **Frontend**: DevTools → Console + Network. WS-соединения видно в Network → WS.
- **Backend dev**: в окне где запущен uvicorn — все запросы и stacktrace.
- **Backend prod**: `sudo journalctl -u roofcinema-backend -f`.

### Текущее состояние сервера (если ты деплоил)
- IP `93.88.203.172`, root `C9RgYEfdhVWgx`.
- Пользователь `roofadmin` создан с паролем `33774Dancom`.
- PostgreSQL установлен, но БД создана с **неправильным owner'ом** — см. п. 6.3 как починить.
- Дальше шаги 7–15 DEPLOYMENT.md ещё не выполнены (предположительно, нужно уточнить).

---

## 10. Контекст последних обсуждений

Последние pending-вопросы от пользователя в этой сессии (перед handoff):

1. **«В админ-панели в разделе бронирования название фильма чёрного цвета, а нужно белого»** — см. п. 6.1.
2. **«Проверь что при бронировании в админ-разделе данные появляются в реальном времени»** — пользователь говорит, что приходилось перезагружать страницу. Это баг WebSocket — см. п. 6.2.
3. **«Как удалить БД с пользователем если ввёл именно так: CREATE USER roofadmin... CREATE DATABASE roofcinema OWNER roofcinema; GRANT ALL ... TO roofcinema»** — см. п. 6.3.
4. **«Давай перейдём к следующей фазе»** — Фаза 5 (оплата переводом с чеками), описана выше.

---

## 11. Что важно помнить при продолжении

1. **Каждая правка модели = `rm roofcinema.db` + перезапуск backend + `python scripts/seed_dev.py`**. SQLAlchemy `create_all` не добавляет колонки в существующие таблицы.

2. **Windows-кодировка**: на машине пользователя кириллица в shell иногда ломается (cp1251). Для теста API через httpx — `params={'q': 'Москва'}` работает; через curl с inline-аргументами — нет.

3. **bcrypt пароль ограничен 72 байтами** — в `security.py` явно режется `[:72]`.

4. **JWT теперь содержит `jti`** — при изменении логики токенов помни про синхронизацию с `UserSession`.

5. **Реалтайм** ограничен **одним процессом uvicorn**. Прод с `--workers > 1` сломает WebSocket. Для масштабирования нужен Redis pub/sub.

6. **Аплоады складываются в `backend/uploads/`** — если переразвернёшь, не забудь скопировать.

7. **При работе с CSS** — все размеры через переменные `--s-*`, `--fs-*`, `--r-*`, `--ctl-h`. Не вписывай числа напрямую, иначе нарушится консистентность.

8. **Бургер-меню**: брейкпоинт `880px` (`@media (min-width: 880px)`).

9. **Force initial-setup**: если флаг `requires_initial_setup=true`, юзер заперт на `/initial-setup`. Это backend-только проверка — фронт-гард `<SetupGuard>` лишь UX.

10. **Адрес крыши** показывается только если у пользователя есть **оплаченная** бронь на эту крышу (статус paid/paid_by_balance/attended). Проверь логику в `rooftops.py::_user_can_see_address`.

---

## 12. Финальные команды для следующей сессии

При продолжении новой сессией скажи:
> Я работаю над проектом «Кино на крыше» в `F:\Проекты\RoofCinema`. Прочитай `handoff.md` в корне проекта — там полное состояние. Нужно [конкретная задача].

Конкретные задачи на старте новой сессии:
1. Исправить чёрный цвет названия фильма в `BookingsAdmin.tsx` → белый.
2. Починить WebSocket-реалтайм — переключить `_broadcast` в bookings.py на `BackgroundTasks` или сделать роутеры async.
3. Реализовать Фазу 5 — загрузка чека + админ-подтверждение оплаты переводом.
