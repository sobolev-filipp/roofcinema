# Handoff: «Кино на крыше» (RoofCinema)

Документ для продолжения проекта в новой сессии. Описывает что это, что сделано, что осталось, стек и действующие недочёты. **Проект уже в проде.**

---

## 1. О проекте

**Что это:** PWA для бронирования мест на показах кино на крышах (Россия). Поток пользователя: город → фильм → показ на конкретной крыше → бронь места → оплата (перевод с загрузкой чека ИЛИ с баланса) → QR-билет → проход по QR/коду на входе.

**Аудитория:** Россия. Тёмная тема по умолчанию (есть переключатель светлой). Работает как сайт и как устанавливаемое PWA.

**Папка проекта:** `F:\Проекты\RoofCinema` (Windows-машина пользователя).

**Роли:** `super_admin` (владелец) / `admin` (с гранулярными правами) / `user`.

---

## 2. СТАТУС: В ПРОДЕ ✅

Проект **развёрнут и работает на VPS**. На проде всё функционирует, включая отправку писем.

**VPS:**
- Host: `93.88.203.172`, путь `/var/www/roofcinema/`
- systemd-сервис: `roofcinema` (uvicorn), nginx раздаёт фронт из `frontend/dist/`
- БД прод: SQLite `/var/www/roofcinema/data/roofcinema.db` (НЕ в git, деплоем не трогается)
- Деплой: `ssh root@93.88.203.172` → `/var/www/roofcinema/deploy.sh`
  (git pull → pip install → npm build → systemctl restart roofcinema → reload nginx)
- Подробности: `docs/DEPLOYMENT.md`

**Миграции:** Alembic НЕ используется. При старте `lifespan` в `main.py`:
`Base.metadata.create_all()` создаёт новые таблицы, `_migrate_columns()` через `ALTER TABLE` добавляет новые колонки (идемпотентно). После деплоя новые таблицы/колонки появляются автоматически — ручных шагов не нужно.

---

## 3. Стек

### Backend (`backend/`)
- **Python 3.13**, **FastAPI** + **uvicorn**, **SQLAlchemy 2.x**, **Pydantic v2** (pydantic-settings)
- **SQLite** (и dev, и прод сейчас)
- **JWT** (`python-jose`) с `jti` → таблица `UserSession` (отзыв сессий)
- **bcrypt** напрямую
- **2FA при входе**: OTP-код на email (таблица `LoginCode`)
- **SMTP** (`smtplib`) — Gmail; `_open_smtp()` сам выбирает SSL(465)/STARTTLS(587). Если `SMTP_HOST` пуст → dev-режим, письмо печатается в консоль `[DEV-EMAIL]`
- **WebSocket** in-process broadcaster (`ws_manager.py`), комнаты `screening:{id}`
- 3 фоновые задачи в `lifespan` (см. §6)
- Запуск dev: `cd backend && python run_dev.py` → `127.0.0.1:8010` (флаг `--lan` для теста с телефона)

### Frontend (`frontend/`)
- **React 18** + **TypeScript** + **Vite 5** + **React Router**
- Без UI-библиотек — своя дизайн-система в `src/styles.css` (CSS-переменные, mobile-first)
- **PWA**, нижняя навигация на мобильных (`Header.tsx`), бургер скрыт на мобиле
- Тема light/dark — `src/theme.tsx` (`<html data-theme>`, localStorage)
- Leaflet (CDN) — карта крыши; QR через `api.qrserver.com`; `qr-scanner` (npm) — сканер на входе
- Запуск dev: `cd frontend && npm run dev` (Vite proxy `/api` и `/uploads` → `127.0.0.1:8010`)

### Внешние API (опциональны)
Kinopoisk Unofficial + OMDb (поиск фильмов), Nominatim (геокодер), api.qrserver.com (QR). Всё проксируется бэком.

---

## 4. Что СДЕЛАНО

### Базовое
- Аутентификация JWT+jti, роли, гранулярные права админа (`AdminPermission`), invite-ссылки админов крыш.
- **2FA**: вход = `/login-json` (логин/пароль → `mfa_token`) → `/login-verify` (6-значный код с почты → JWT). `LoginPage.tsx` двухшаговый.
- Email-верификация (PIN), сброс пароля, активные сессии, forced initial-setup владельца.
- Каталог: города, крыши (с приватностью адреса — зона 3 км пока бронь не оплачена), типы мест, фильмы (поиск Kinopoisk/OMDb + кадры).
- Показы: `Screening` с `starts_at`, **`ends_at`** (необязательно; иначе = `starts_at + movie.duration_min`, иначе +3ч), окно бронирования, payout-шаблон.
- Бронирование с таймером, авто-истечение (`_expire_overdue`), перенос, продление.

### Оплата и чеки
- Оплата переводом: загрузка чека (`ReceiptUploadBox` — **двухшаговый**: выбрать файл → превью → «Отправить»), модерация в админке (раздел «Чеки → Входящие»).
- Пока чек на проверке — **таймер заморожен** визуально; при отказе админ пишет причину; `expires_at` продлевается на время проверки, и **если осталось < 25% — добавляется ещё +25%** окна.
- **Письмо «После оплаты»** (шаблон `post_payment`, с QR/кодом) шлётся автоматически при: подтверждении чека, ручной отметке «оплачено», ручной броне сразу оплаченной (в т.ч. полностью с баланса). Логика в `backend/app/booking_notify.py::send_post_payment_email`.
- **Пост-чеки** (чек ПОСЛЕ показа для бухучёта): галка при бронировании `needs_post_show_receipt`; раздел «Чеки → Чеки для отправки» (вкладки «Ждут отправки»/«Отправленные») с визуальными статусами; админ грузит файл → отправляется письмом-вложением (`post_show_receipt`) автоматически после окончания показа (фоновая задача), или сразу если показ уже прошёл. Если файл не прикреплён к концу показа — дайджест админам.

### Баланс по EMAIL (важно!)
- Баланс привязан к **email**, не к аккаунту — таблица `EmailBalance(email, amount)`, модуль `backend/app/balance.py` (`get_balance/credit_balance/debit_balance/serialize_user`).
- Возврат на баланс работает **без аккаунта**. При подтверждении email брони с этой почтой привязываются к пользователю (`_link_orphan_bookings` в `auth.py`), баланс автоматически виден.
- Оплата с баланса: пользователь (`apply-balance`/`pay-by-balance`) и админ в ручной броне (`use_balance`).

### Отмена показа целиком
- Кнопка «Отменить показ» в `BookingsAdmin` → модалка с **выбором шаблона** письма (`admin_cancel_screening`) + причиной (`{reason}`).
- Показ → `cancelled_at`, уходит в «Завершённые» с бейджем «отменён». Оплаченным броням ставится `needs_cancel_resolution=True`, неоплаченные аннулируются.
- Раздел **«Отмена показа»** (`CancellationsAdmin`): по каждой броне — Перенести / → на баланс / Возврат денег. Real-time (poll 10с) + бейдж. Роутер `cancellations.py`.

### Клиенты
- Раздел **«Клиенты»** (`CustomersAdmin`): поиск гостя → баланс + его брони (активные/история) → перенос / возврат на баланс / отмена. Бэк: `GET /api/admin/bookings/by-email`.

### Статистика
- Раздел **«Статистика»** (`StatisticsAdmin`) — CSS бар-чарт (без библиотек) по месяцам/неделям: показы, гости, выручка, отмены, переносы. История листается. Право `view_statistics`. Роутер `statistics.py`. Переносы пишутся в `BookingTransfer`.

### Шаблоны сообщений (`MessageTemplate`, kinds)
`manual_booking`, `pre_booking_info` (запрос данных перед ручной бронью; кнопка в ManualBooking), `post_payment`, `post_show_receipt`, `payment_reminder`, `welcome_on_checkin`, `user_cancel_notice`, `admin_cancel_screening`, `refund_link`, `custom`.
Плейсхолдеры — в `backend/app/utils.py::TEMPLATE_PLACEHOLDERS`; подсказки/демо — в `MessageTemplatesAdmin.tsx`.

### Уведомления / фоновые задачи (`main.py` lifespan)
- `_notify_loop` — письма «открылось бронирование» по подпискам.
- `_post_show_receipt_loop` (5 мин) — автоотправка пост-чеков после показа + дайджест админам.
- `_payment_reminder_loop` (60с) — напоминание оплатить, когда осталось < 25% времени (шаблон `payment_reminder`, плейсхолдеры `{minutes_left}`, `{payout_details}` и т.д.).

### Check-in
- `CheckInAdmin` — сканер QR / ввод кода → подтверждение прохода. При подтверждении шлётся приветственное письмо (`welcome_on_checkin`). Анимация поиска — кино-проектор (`ProjectorLoader`).

### UX/Дизайн
- `components/Loaders.tsx`: `<Spinner>` (в кнопках), `<ProjectorLoader>` (блокирующий оверлей с анимацией проектора), `<Skeleton>` (загрузка списков). Раскатаны по всем страницам.
- Тема light/dark (профиль → «Внешний вид»).
- Нижнее меню на мобиле — фиксированная высота (`56px + safe-area`), всегда прижато.
- Админ-табы: горизонтальный скролл колесом мыши + drag + тонкий скроллбар (`AdminLayout.tsx`).
- Статусы-бейджи: `white-space: nowrap`, `.badge.accent` — красный фон/белый текст; `.status-pill` — мягкая заливка `color-mix`.
- `color-scheme: dark` + инверсия иконок date/time. Movie picker — модалка с поиском (`MoviePickerModal`).

---

## 5. Структура (новые/ключевые файлы)

```
backend/app/
  main.py            # lifespan: create_all + _migrate_columns + 3 фоновые задачи; include_router всех
  config.py          # .env: SMTP_*, SMTP_USE_SSL, APP_BASE_URL, SUPER_ADMIN_*
  models.py          # ВСЕ модели (см. §7)
  schemas.py         # ВСЕ Pydantic-схемы
  balance.py         # ★ баланс по email (get/credit/debit/serialize_user)
  booking_notify.py  # ★ build_booking_context / render_booking_template / send_post_payment_email
  email_service.py   # _open_smtp() (SSL/STARTTLS), send_email, send_email_with_attachment, дайджесты
  utils.py           # TEMPLATE_PLACEHOLDERS, render_template, now_in_tz, RU_TIMEZONES, _normalize_age_rating
  routers/
    auth.py users.py cities.py rooftops.py seat_types.py movies.py movie_search.py
    screenings.py bookings.py payout_templates.py message_templates.py
    admin_bookings.py   # поиск юзеров, ручная бронь, check-in, /email-balance, /bookings/by-email
    receipts.py         # входящие чеки (approve/reject)
    post_show_receipts.py  # ★ пост-чеки
    cancellations.py    # ★ отмена показа + раздел разрешения
    refunds.py          # возвраты (refund-request)
    statistics.py       # ★ статистика
    uploads.py geocode.py ws.py

frontend/src/
  api.ts theme.tsx auth.tsx ui.tsx styles.css
  lib/{bookingStatus,screening,embed,useBookingsWs,hooks}.ts
  components/{Loaders,MoviePickerModal,ReceiptUploadBox,BookingForm,AdminTemplateCopyBox,...}.tsx
  pages/{HomePage,MoviePage,RooftopPage,BookingPage,MyBookingsPage,ProfilePage,...}.tsx
  pages/admin/{AdminLayout,CitiesAdmin,RooftopsAdmin,RooftopAdmin,MoviesAdmin,MovieAdmin,
    ScreeningsAdmin,BookingsAdmin,CustomersAdmin,ManualBookingAdmin,ReceiptsAdmin,
    RefundsAdmin,CancellationsAdmin,PayoutTemplatesAdmin,MessageTemplatesAdmin,
    CheckInAdmin,StatisticsAdmin,AdminsAdmin}.tsx
```

---

## 6. Модели данных (ключевое в `models.py`)

- **User**: role, permissions(JSON), `balance` (★ устарел — обнулён миграцией, баланс теперь в EmailBalance), is_email_verified, requires_initial_setup.
- **EmailBalance**(email уникальный, amount) — ★ источник правды по балансу.
- **Booking**: status, expires_at, total_amount, **balance_used**, qr_token, short_code,
  **needs_post_show_receipt**, **post_show_admin_notified_at**, **payment_reminder_sent_at**, **needs_cancel_resolution**.
- **Screening**: starts_at, **ends_at**, **cancelled_at**, booking_window_minutes, payout_template_id.
- **PostShowReceipt**(booking_id uniq, file_url, sent_at, sent_by_admin_id).
- **BookingTransfer**(booking_id, from/to_screening_id, admin_id, created_at) — журнал переносов.
- **LoginCode**(mfa_token, user_id, code) — 2FA.
- PaymentReceipt, RefundRequest, BookingAttendee, MessageTemplate, ScreeningSeatType, BookingItem, UserSession, EmailVerification, PasswordResetToken, RooftopAdmin(Invite).
- **AdminPermission** enum включает `view_statistics`.
- **MessageTemplateKind** — 10 видов (см. §4).

---

## 7. ПРЕДСТОИТ СДЕЛАТЬ (приоритетные задачи)

### 7.1. ★ Кнопка «Запросить возврат средств» в профиле (рядом с балансом)
**Проблема:** в разделе «Клиенты», если у гостя НЕТ активных броней, но баланс ≠ 0, то нет способа вернуть ему деньги — кнопки возврата привязаны к броням.

**Что нужно:**
- В `ProfilePage.tsx` рядом с балансом добавить кнопку **«Запросить возврат средств»** (показывать если `balance > 0`).
- Пользователь вводит реквизиты (ФИО, карта/СБП, банк) → создаётся запрос на возврат, который падает в админ-раздел **«Возвраты»** уже с реквизитами.
- **Backend:** сейчас `RefundRequest` привязан к `booking_id` (one-to-one, обязателен). Нужно либо:
  - (а) сделать `RefundRequest.booking_id` nullable и добавить поля `email` + `amount` для возврата с баланса, либо
  - (б) отдельная сущность `BalanceRefundRequest`.
  Рекомендую (а) с минимальной правкой `refunds.py` + схем. При создании — списать сумму с `EmailBalance` (debit) сразу или при завершении возврата (решить: списывать при создании запроса, чтобы нельзя было потратить дважды).
- Раздел «Возвраты» (`RefundsAdmin`) должен корректно отображать такие запросы (без брони/показа).

### 7.2. ★ «Клиенты»: отменённые брони показываются как активные
**Проблема:** в `CustomersAdmin` отменённые брони (и/или брони на отменённом показе со статусом всё ещё `paid` + `needs_cancel_resolution`) выводятся как активные → доступны кнопки «отменить»/«возврат», хотя действие невозможно (бронь уже отменена / деньги уже на балансе или возвращены).

**Что нужно:**
- В `CustomersAdmin.tsx` множество `ACTIVE` сейчас = `{waiting_payment, paid, paid_by_balance, attended}`. Брони со статусом `cancelled`/`refunded`/`expired` уже идут в «Историю». Проверить кейс брони на отменённом показе (статус остаётся `paid`, но `needs_cancel_resolution=true`) — её надо выводить с пометкой, а не как обычную активную.
- Если бронь **отменена и выбран возврат денег (не на баланс), но деньги ещё не возвращены** → статус брони `refund_pending`. Показывать чёткую пометку **«ожидание возврата средств»** (а не предлагать снова отменить/вернуть).
- Скрывать/блокировать действия, которые невозможны для уже отменённых/возвращённых броней. В `BookingCard` уже есть флаги `canTransfer/canRefundBalance/canCancel` — выверить их по статусам:
  - `refund_pending` → только просмотр + пометка «ожидание возврата».
  - `refunded`/`cancelled`/`expired` → в «Историю», без действий.
- Возможно стоит показывать `needs_cancel_resolution` брони отдельным блоком «требует решения».

### Прочее не сделано
- **Фаза 9 (полировка PWA):** проверить manifest/service worker, офлайн, политика 152-ФЗ.
- Проверка работоспособности ссылки трейлера (кнопка «проверить») в `MovieAdmin`.
- Скелетоны/спиннеры есть почти везде; точечно можно добить оставшиеся `disabled={busy}`-кнопки без `<Spinner>` (напр. часть кнопок в `BookingPage`).

---

## 8. ДЕЙСТВУЮЩИЕ НЕДОЧЁТЫ / ограничения

1. **Локальная отправка почты не работает (на проде — ОК).** На dev-машине стоят **Kaspersky** (модули «Почтовый Антивирус» + «Проверка защищённых соединений») и **VanyaVPN** — они перехватывают/режут SMTP: TCP-сокет открывается, но SMTP-приветствие/TLS-handshake виснут (timeout) на 587 и 465. Это НЕ баг кода.
   - Для локального теста почты: отключить VPN, и/или приостановить Kaspersky / добавить `python.exe` в исключения «не проверять сетевой трафик», и/или временно очистить `SMTP_HOST` в `.env` → письма уйдут в консоль `[DEV-EMAIL]`.
2. **WebSocket при `--workers > 1` не работает** — broadcaster in-process. Для прода с несколькими воркерами нужен Redis pub/sub. Сейчас один воркер — ок. На страницах брони/броней есть подстраховочный polling (5–15с), так что реалтайм всё равно деградирует мягко.
3. **Доставляемость Gmail → спам** на mail.ru. Решение: свой домен + SPF/DKIM (Yandex 360 / SendPulse). Прод сейчас на Gmail-отправителе.
4. **Часовые пояса:** `screening.starts_at`/`ends_at` хранятся как наивное локальное время крыши; `expires_at`/`cancelled_at`/`paid_at` — UTC. Фронт это учитывает (`lib/bookingStatus.ts::parseUtc`, `lib/screening.ts`, `BookingScreeningInfo.city_timezone`). При новых датах не забывать про эту конвенцию.
5. **Alembic нет** — все изменения схемы только через `_migrate_columns()` в `main.py` (ALTER TABLE с проверкой существования колонки) + `create_all` для новых таблиц.

---

## 9. Как продолжить в новой сессии

1. Запустить бэк: `cd backend && python run_dev.py` (порт 8010). Фронт: `cd frontend && npm run dev`.
   - Если видишь `ECONNREFUSED 127.0.0.1:8010` в выводе Vite — просто не запущен бэкенд.
2. Проверка импорта бэка после правок: `cd backend && python -c "import app.main; print('OK')"`.
3. Следующие задачи — §7.1 и §7.2 (возврат с баланса из профиля + корректные статусы отменённых броней в «Клиентах»).
4. Конвенции: модели/схемы — по одному файлу (`models.py`/`schemas.py`); письма по броням — через `booking_notify.py`; баланс — только через `balance.py` (по email!); новые колонки — добавлять и в модель, и в `_migrate_columns()`.
5. Деплой: `git push` → на VPS `/var/www/roofcinema/deploy.sh`. Не забыть про шаблоны в `/admin/templates` для новых kind.
