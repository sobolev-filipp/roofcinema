from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, String, Integer, ForeignKey, DateTime, Boolean, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class UserRole(str, Enum):
    super_admin = "super_admin"
    admin = "admin"
    user = "user"


class AdminPermission(str, Enum):
    """Гранулярные права приглашённого администратора.
    super_admin всегда имеет все права; admin с permissions=None считается «старым» — тоже все права.
    admin с конкретным списком — только выбранные права."""
    manage_rooftops         = "manage_rooftops"           # создавать/редактировать крыши
    manage_movies           = "manage_movies"             # добавлять/редактировать фильмы
    manage_screenings       = "manage_screenings"         # создавать/редактировать показы
    manage_bookings         = "manage_bookings"           # работать с бронированиями
    manage_customers        = "manage_customers"          # раздел «Клиенты» (поиск гостя, баланс, возвраты)
    manage_transfers        = "manage_transfers"          # делать переносы броней
    manage_cancellations    = "manage_cancellations"      # раздел «Отмена показа»
    manual_booking          = "manual_booking"            # добавлять брони вручную
    manage_receipts         = "manage_receipts"           # работать с чеками
    manage_refunds          = "manage_refunds"            # работать с возвратами
    manage_payout_templates = "manage_payout_templates"   # реквизиты для оплаты
    manage_templates        = "manage_templates"          # шаблоны сообщений
    check_in                = "check_in"                  # раздел «Вход» (QR-сканер)
    view_statistics         = "view_statistics"           # раздел «Статистика» (графики и сводки)
    manage_admins           = "manage_admins"             # просмотр/редактирование прав других админов


def utcnow() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default=UserRole.user.value)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    social_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)

    home_city_id: Mapped[int | None] = mapped_column(ForeignKey("cities.id", ondelete="SET NULL"), nullable=True)
    balance: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    requires_initial_setup: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    permissions: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    home_city = relationship("City", foreign_keys=[home_city_id])
    rooftop_admin_links = relationship("RooftopAdmin", back_populates="user", cascade="all, delete-orphan")


class EmailBalance(Base):
    """Баланс, привязанный к EMAIL, а не к аккаунту.

    Так возврат на баланс работает даже для гостей без аккаунта: деньги копятся
    на email. Когда человек зарегистрируется и подтвердит этот email — баланс
    автоматически становится «его» (мы читаем баланс по email пользователя).
    Email хранится в нижнем регистре."""
    __tablename__ = "email_balances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class EmailVerification(Base):
    """Код подтверждения email. Один активный на пользователя."""
    __tablename__ = "email_verifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(8), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_sent_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class LoginCode(Base):
    """Одноразовый OTP-код для двухфакторного входа.
    Создаётся при успешной проверке логина/пароля; JWT выдаётся только после подтверждения кода."""
    __tablename__ = "login_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mfa_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(8), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_sent_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class PasswordResetToken(Base):
    """Одноразовый токен для сброса пароля."""
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class UserSession(Base):
    """Активная сессия пользователя. JWT привязан через jti.
    Revoke сессии = jwt этого jti перестаёт работать."""
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    jti: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class City(Base):
    __tablename__ = "cities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    rooftops = relationship("Rooftop", back_populates="city", cascade="all, delete-orphan")


class Rooftop(Base):
    __tablename__ = "rooftops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    city_id: Mapped[int] = mapped_column(ForeignKey("cities.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    lng: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    city = relationship("City", back_populates="rooftops")
    admins = relationship("RooftopAdmin", back_populates="rooftop", cascade="all, delete-orphan")
    invites = relationship("RooftopAdminInvite", back_populates="rooftop", cascade="all, delete-orphan")
    seat_types = relationship("SeatType", back_populates="rooftop", cascade="all, delete-orphan", order_by="SeatType.id")


class SeatType(Base):
    """Тип места на крыше: кресло-мешок, шезлонг и т.п.

    capacity — сколько гостей может занимать ОДИН такой объект. Кресло-мешок=1,
    скамейка на двоих=2. Бронь на 1 скамейку = 2 гостя на сеансе."""
    __tablename__ = "seat_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rooftop_id: Mapped[int] = mapped_column(ForeignKey("rooftops.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    default_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    default_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    rooftop = relationship("Rooftop", back_populates="seat_types")


class RooftopAdmin(Base):
    """Связь админ ↔ крыша (один админ может управлять несколькими крышами)."""
    __tablename__ = "rooftop_admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    rooftop_id: Mapped[int] = mapped_column(ForeignKey("rooftops.id", ondelete="CASCADE"), nullable=False, index=True)
    can_manage_movies: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    can_manage_bookings: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    can_check_tickets: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    can_approve_payments: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    user = relationship("User", back_populates="rooftop_admin_links")
    rooftop = relationship("Rooftop", back_populates="admins")


class Movie(Base):
    __tablename__ = "movies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    original_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    poster_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    backdrop_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    trailer_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    age_rating: Mapped[str | None] = mapped_column(String(8), nullable=True)
    genres: Mapped[str | None] = mapped_column(String(255), nullable=True)
    director: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kinopoisk_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    imdb_id: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    imdb_rating: Mapped[float | None] = mapped_column(Numeric(3, 1), nullable=True)
    kinopoisk_rating: Mapped[float | None] = mapped_column(Numeric(3, 1), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    screenings = relationship("Screening", back_populates="movie", cascade="all, delete-orphan")
    stills = relationship("MovieStill", back_populates="movie", cascade="all, delete-orphan", order_by="MovieStill.position")


class MovieStill(Base):
    """Кадры из фильма."""
    __tablename__ = "movie_stills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    movie_id: Mapped[int] = mapped_column(ForeignKey("movies.id", ondelete="CASCADE"), nullable=False, index=True)
    image_url: Mapped[str] = mapped_column(String(512), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    movie = relationship("Movie", back_populates="stills")


class PayoutTemplate(Base):
    """Шаблон реквизитов для оплаты переводом. Назначается на показ."""
    __tablename__ = "payout_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    recipient_name: Mapped[str] = mapped_column(String(255), nullable=False)
    card_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class Screening(Base):
    """Показ конкретного фильма на конкретной крыше в конкретное время.
    starts_at хранится как наивное локальное время в часовом поясе крыши.

    booking_opens_at / booking_closes_at — окно бронирования. None у opens_at = всегда открыто,
    None у closes_at = открыто до начала показа."""
    __tablename__ = "screenings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    movie_id: Mapped[int] = mapped_column(ForeignKey("movies.id", ondelete="CASCADE"), nullable=False, index=True)
    rooftop_id: Mapped[int] = mapped_column(ForeignKey("rooftops.id", ondelete="CASCADE"), nullable=False, index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    # Локальное наивное время окончания показа в TZ крыши. Если null —
    # фоновая задача оценит окончание как starts_at + 3ч (типовая длительность).
    ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Показ отменён администратором (≠ скрыт). Брони уходят в раздел «Отмена показа».
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Когда отправили админам письмо-итог после окончания показа (сводка по броням).
    # Чтобы фоновая задача не слала повторно.
    booking_summary_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    booking_window_minutes: Mapped[int] = mapped_column(Integer, default=120, nullable=False)
    booking_opens_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    booking_closes_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    base_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    payout_template_id: Mapped[int | None] = mapped_column(
        ForeignKey("payout_templates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    movie = relationship("Movie", back_populates="screenings")
    rooftop = relationship("Rooftop")
    seats = relationship("ScreeningSeatType", back_populates="screening", cascade="all, delete-orphan", order_by="ScreeningSeatType.id")
    payout_template = relationship("PayoutTemplate")


class ScreeningSeatType(Base):
    """Снапшот доступного типа мест для конкретного показа.
    Хранит name + capacity, чтобы пережить удаление/изменение SeatType."""
    __tablename__ = "screening_seat_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    screening_id: Mapped[int] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"), nullable=False, index=True)
    seat_type_id: Mapped[int | None] = mapped_column(ForeignKey("seat_types.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    price: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    screening = relationship("Screening", back_populates="seats")
    booking_items = relationship("BookingItem", back_populates="screening_seat_type")


class BookingStatus(str, Enum):
    waiting_payment = "waiting_payment"  # ждёт оплаты, идёт таймер
    paid = "paid"                         # оплачено
    attended = "attended"                 # пользователь посетил сеанс
    no_show = "no_show"                   # не посетил
    cancelled = "cancelled"               # отменено до оплаты
    expired = "expired"                   # вышел срок оплаты
    refund_pending = "refund_pending"     # ожидание возврата
    refunded = "refunded"                 # возврат выполнен
    paid_by_balance = "paid_by_balance"   # оплачено с баланса/сертификата


ACTIVE_BOOKING_STATUSES = (
    BookingStatus.waiting_payment.value,
    BookingStatus.paid.value,
    BookingStatus.attended.value,
    BookingStatus.paid_by_balance.value,
)


class Booking(Base):
    """Бронь пользователя на показ. На каждое выбранное место — позиция в BookingItem."""
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    screening_id: Mapped[int] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"), nullable=False, index=True)

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    social_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    status: Mapped[str] = mapped_column(String(32), default=BookingStatus.waiting_payment.value, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    balance_used: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)

    qr_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    short_code: Mapped[str] = mapped_column(String(12), unique=True, index=True, nullable=False)

    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Пользователь / админ при создании отметил, что нужен чек после показа
    # (для бухучёта). Админ потом загрузит файл и отправит на email — см. PostShowReceipt.
    needs_post_show_receipt: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Когда отправили дайджест админам с напоминанием прикрепить чек.
    # Чтобы не слать одно и то же повторно.
    post_show_admin_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Когда отправили напоминание пользователю «осталось < 25% времени на оплату».
    payment_reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Показ этой брони отменён — ждёт решения админа (перенос / возврат / на баланс).
    # Раздел «Отмена показа» показывает именно такие брони.
    needs_cancel_resolution: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    screening = relationship("Screening")
    items = relationship("BookingItem", back_populates="booking", cascade="all, delete-orphan")
    receipts = relationship(
        "PaymentReceipt",
        back_populates="booking",
        cascade="all, delete-orphan",
        order_by="PaymentReceipt.uploaded_at.desc()",
    )
    attendees = relationship(
        "BookingAttendee",
        back_populates="booking",
        cascade="all, delete-orphan",
        order_by="BookingAttendee.id",
    )
    refund_request = relationship(
        "RefundRequest",
        back_populates="booking",
        uselist=False,   # one-to-one (booking_id unique)
        cascade="all, delete-orphan",
    )
    post_show_receipt = relationship(
        "PostShowReceipt",
        back_populates="booking",
        uselist=False,   # one-to-one (booking_id unique)
        cascade="all, delete-orphan",
    )


class BookingItem(Base):
    """Одна строка брони: тип места × количество.
    name и price_each — снапшот, чтобы пережить любое изменение исходного типа."""
    __tablename__ = "booking_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    screening_seat_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("screening_seat_types.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    price_each: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    qty: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    booking = relationship("Booking", back_populates="items")
    screening_seat_type = relationship("ScreeningSeatType", back_populates="booking_items")


class RefundRequestStatus(str, Enum):
    created = "created"        # запрос создан, пользователь ещё не заполнил реквизиты
    filled = "filled"          # пользователь ввёл реквизиты, админ ещё не перевёл
    completed = "completed"    # админ пометил «перевод выполнен»


class RefundRequest(Base):
    """Запрос на возврат денег по отменённой брони.
    Создаётся админом, дальше — публичная форма /refund/{token} где
    пользователь вводит ФИО/реквизиты. Админ потом помечает как выполненный."""
    __tablename__ = "refund_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # nullable: возврат может быть «с баланса» — без привязки к конкретной броне.
    # В этом случае получатель определяется по email (ниже).
    booking_id: Mapped[int | None] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=True, unique=True, index=True)
    # Email получателя для возврата с баланса (когда booking_id is None).
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default=RefundRequestStatus.created.value, nullable=False, index=True)
    payout_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)

    # заполняются пользователем через публичную форму
    payout_full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payout_card_or_sbp: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payout_bank: Mapped[str | None] = mapped_column(String(120), nullable=True)
    payout_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Необязательный чек о переводе, который админ прикрепляет при отметке «выполнено».
    # Если задан — уходит во вложении в письме о завершении возврата.
    receipt_file_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    created_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    completed_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    link_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    booking = relationship("Booking", back_populates="refund_request")


class PostShowReceipt(Base):
    """Чек, отправляемый пользователю на email ПОСЛЕ показа (по запросу при бронировании).
    Один на бронь. sent_at заполняется когда письмо с прикреплённым файлом ушло."""
    __tablename__ = "post_show_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    file_url: Mapped[str] = mapped_column(String(512), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    booking = relationship("Booking", back_populates="post_show_receipt")


class BookingTransfer(Base):
    """Журнал переносов брони с одного показа на другой.
    Каждое нажатие «перенести» порождает новую запись (cancelled_at не используется
    — это иммутабельный лог событий)."""
    __tablename__ = "booking_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    from_screening_id: Mapped[int | None] = mapped_column(ForeignKey("screenings.id", ondelete="SET NULL"), nullable=True, index=True)
    to_screening_id: Mapped[int | None] = mapped_column(ForeignKey("screenings.id", ondelete="SET NULL"), nullable=True, index=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False, index=True)


class MessageTemplateKind(str, Enum):
    """Назначение шаблона. Один kind может иметь несколько шаблонов, один помечен default."""
    manual_booking = "manual_booking"               # текст для отправки пользователю при ручной броне
    pre_booking_info = "pre_booking_info"           # запрос данных у пользователя ПЕРЕД ручной бронью
    post_payment = "post_payment"                   # после подтверждения оплаты (с QR и кодом)
    post_show_receipt = "post_show_receipt"         # сопровождение чека после показа (письмо + вложение)
    payment_reminder = "payment_reminder"           # напоминание оплатить (остаётся < 25% времени)
    welcome_on_checkin = "welcome_on_checkin"       # приветствие при отметке прихода (QR / код)
    user_cancel_notice = "user_cancel_notice"       # письмо пользователю об отмене брони
    admin_cancel_screening = "admin_cancel_screening"  # отмена всего показа
    refund_link = "refund_link"                     # сопровождение ссылки для возврата средств
    refund_completed = "refund_completed"           # уведомление о выполненном возврате средств
    custom = "custom"                                # произвольный шаблон


class MessageTemplate(Base):
    """Шаблон сообщения с плейсхолдерами вида {movie}, {starts_at}, {booking_link} и т.п.
    Подставляются через utils.render_template() — неизвестные плейсхолдеры
    остаются в тексте как есть, чтобы админ заметил опечатку."""
    __tablename__ = "message_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class ScreeningBookingNotify(Base):
    """Подписка пользователя на уведомление о старте бронирования показа.
    Когда наступит screening.booking_opens_at — фоновая задача шлёт письмо
    и проставляет notified_at."""
    __tablename__ = "screening_booking_notifies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    screening_id: Mapped[int] = mapped_column(ForeignKey("screenings.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    screening = relationship("Screening")


class PaymentReceiptStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class PaymentReceipt(Base):
    """Чек об оплате, загруженный пользователем для брони (оплата переводом).
    Админ подтверждает или отклоняет — при подтверждении бронь становится paid."""
    __tablename__ = "payment_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    image_url: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=PaymentReceiptStatus.pending.value, nullable=False, index=True)
    amount_claimed: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    booking = relationship("Booking", back_populates="receipts")
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_id])


class BookingAttendee(Base):
    """Гость, на которого «разделена» часть мест из брони.
    Платит главный бронирующий — у attendee только свои QR/short_code/claim-ссылка.

    guests_count — сколько человек этот гость покрывает (например, 2 если ему отдают скамейку).
    claim_token — публичная магическая ссылка вида /claim/{token}: по ней можно
    посмотреть билет без аккаунта и опционально привязать к своему профилю."""
    __tablename__ = "booking_attendees"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    guests_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    qr_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    short_code: Mapped[str] = mapped_column(String(12), unique=True, index=True, nullable=False)
    claim_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)

    claimed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    booking = relationship("Booking", back_populates="attendees")
    claimed_by = relationship("User", foreign_keys=[claimed_by_user_id])


class RooftopAdminInvite(Base):
    """Одноразовая ссылка, по которой пользователь становится админом крыши."""
    __tablename__ = "rooftop_admin_invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rooftop_id: Mapped[int] = mapped_column(ForeignKey("rooftops.id", ondelete="CASCADE"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    accepted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    permissions: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
    # Список дополнительных крыш (сверх rooftop_id). Если задан — принимаются
    # RooftopAdmin-ссылки для ВСЕХ ids из этого списка (rooftop_id включён автоматически).
    target_rooftop_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    rooftop = relationship("Rooftop", back_populates="invites")
