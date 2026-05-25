from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)
    home_city_id: int | None = None
    pd_consent: bool = Field(description="Согласие на обработку персональных данных (152-ФЗ)")


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    role: str
    avatar_url: str | None = None
    phone: str | None = None
    social_url: str | None = None
    bio: str | None = None
    home_city_id: int | None = None
    balance: float = 0
    is_email_verified: bool = False
    requires_initial_setup: bool = False
    created_at: datetime


class UserUpdateIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=512)
    phone: str | None = Field(default=None, max_length=32)
    social_url: str | None = Field(default=None, max_length=512)
    bio: str | None = None
    home_city_id: int | None = None


class CityIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str | None = Field(default=None, max_length=255, pattern=r"^[a-z0-9-]+$")
    timezone: str = "Europe/Moscow"


class CityUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    slug: str | None = Field(default=None, max_length=255, pattern=r"^[a-z0-9-]+$")
    timezone: str | None = None
    is_active: bool | None = None


class CityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    timezone: str
    is_active: bool


class RooftopIn(BaseModel):
    city_id: int
    name: str = Field(min_length=1, max_length=255)
    address: str = Field(default="", max_length=512)
    description: str | None = None
    cover_url: str | None = Field(default=None, max_length=512)
    lat: float | None = None
    lng: float | None = None


class RooftopUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=512)
    description: str | None = None
    cover_url: str | None = Field(default=None, max_length=512)
    lat: float | None = None
    lng: float | None = None
    is_active: bool | None = None


class RooftopOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    city_id: int
    name: str
    address: str
    description: str | None = None
    cover_url: str | None = None
    lat: float | None = None
    lng: float | None = None
    is_active: bool


class RooftopPublicOut(BaseModel):
    """Публичная карточка крыши. Точный адрес и точные координаты
    отдаём только пользователю с подтверждённой бронью или админу;
    остальные получают приближённые координаты и радиус неопределённости."""
    id: int
    city_id: int
    city_name: str
    city_timezone: str
    name: str
    description: str | None = None
    cover_url: str | None = None
    address: str | None = None       # точный адрес — только для админа/брони
    lat: float | None = None         # точные координаты — только для админа/брони
    lng: float | None = None
    approx_lat: float | None = None  # приближённые координаты для карты
    approx_lng: float | None = None
    approx_radius_m: int = 5000
    can_see_address: bool = False


class MovieStillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    image_url: str
    position: int


class MovieStillIn(BaseModel):
    image_url: str = Field(min_length=1, max_length=512)
    position: int = 0


class MovieIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    original_title: str | None = Field(default=None, max_length=255)
    description: str | None = None
    poster_url: str | None = Field(default=None, max_length=512)
    backdrop_url: str | None = Field(default=None, max_length=512)
    trailer_url: str | None = Field(default=None, max_length=512)
    duration_min: int | None = Field(default=None, ge=1, le=600)
    year: int | None = Field(default=None, ge=1880, le=2100)
    age_rating: str | None = Field(default=None, max_length=8)
    genres: str | None = Field(default=None, max_length=255)
    director: str | None = Field(default=None, max_length=255)
    kinopoisk_id: int | None = None
    imdb_id: str | None = Field(default=None, max_length=16)
    imdb_rating: float | None = Field(default=None, ge=0, le=10)
    kinopoisk_rating: float | None = Field(default=None, ge=0, le=10)


class MovieUpdateIn(MovieIn):
    title: str | None = Field(default=None, max_length=255)


class MovieOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    original_title: str | None = None
    description: str | None = None
    poster_url: str | None = None
    backdrop_url: str | None = None
    trailer_url: str | None = None
    duration_min: int | None = None
    year: int | None = None
    age_rating: str | None = None
    genres: str | None = None
    director: str | None = None
    kinopoisk_id: int | None = None
    imdb_id: str | None = None
    imdb_rating: float | None = None
    kinopoisk_rating: float | None = None
    stills: list[MovieStillOut] = []


class SeatTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    default_price: float = Field(default=0, ge=0)
    default_count: int = Field(default=0, ge=0)


class SeatTypeUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    default_price: float | None = Field(default=None, ge=0)
    default_count: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class SeatTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    rooftop_id: int
    name: str
    default_price: float
    default_count: int
    is_active: bool


class ScreeningSeatTypeIn(BaseModel):
    """Аллокация типа места на конкретный показ — копия из SeatType крыши, но с возможностью перепрайсить."""
    seat_type_id: int
    price: float = Field(ge=0)
    count: int = Field(ge=0)


class ScreeningSeatTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    seat_type_id: int | None
    name: str
    price: float
    count: int


class PayoutTemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    recipient_name: str = Field(min_length=1, max_length=255)
    card_number: str | None = Field(default=None, max_length=32)
    phone: str | None = Field(default=None, max_length=32)
    bank_name: str | None = Field(default=None, max_length=120)
    note: str | None = None
    is_default: bool = False


class PayoutTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    recipient_name: str
    card_number: str | None = None
    phone: str | None = None
    bank_name: str | None = None
    note: str | None = None
    is_default: bool


class ScreeningIn(BaseModel):
    movie_id: int
    rooftop_id: int
    starts_at: datetime
    booking_window_minutes: int = Field(default=120, ge=10, le=24 * 60)
    base_price: float = Field(default=0, ge=0)
    note: str | None = None
    payout_template_id: int | None = None
    seat_allocations: list[ScreeningSeatTypeIn] = Field(default_factory=list)


class ScreeningUpdateIn(BaseModel):
    starts_at: datetime | None = None
    booking_window_minutes: int | None = Field(default=None, ge=10, le=24 * 60)
    base_price: float | None = Field(default=None, ge=0)
    note: str | None = None
    is_active: bool | None = None
    payout_template_id: int | None = None
    seat_allocations: list[ScreeningSeatTypeIn] | None = None


class ScreeningOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    movie_id: int
    rooftop_id: int
    starts_at: datetime
    booking_window_minutes: int
    base_price: float
    is_active: bool
    note: str | None = None
    payout_template_id: int | None = None
    movie: MovieOut
    rooftop: RooftopOut
    seats: list[ScreeningSeatTypeOut] = []
    payout_template: PayoutTemplateOut | None = None


class BookingItemIn(BaseModel):
    screening_seat_type_id: int
    qty: int = Field(ge=1, le=20)


class BookingItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    screening_seat_type_id: int | None
    name: str
    price_each: float
    qty: int


class BookingCreateIn(BaseModel):
    screening_id: int
    items: list[BookingItemIn] = Field(min_length=1)
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    social_url: str | None = Field(default=None, max_length=512)
    pd_consent: bool = Field(description="Согласие на обработку персональных данных (152-ФЗ)")
    note: str | None = None


class BookingScreeningInfo(BaseModel):
    """Урезанные данные о показе/фильме/крыше для отображения в брони.
    rooftop_address заполняется только для оплаченных/посещённых броней."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    starts_at: datetime
    movie_id: int
    movie_title: str
    movie_poster_url: str | None = None
    rooftop_id: int
    rooftop_name: str
    city_name: str
    rooftop_address: str | None = None


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int | None
    screening_id: int
    full_name: str
    email: str
    phone: str | None = None
    social_url: str | None = None
    status: str
    expires_at: datetime
    total_amount: float
    balance_used: float = 0
    qr_token: str
    short_code: str
    note: str | None = None
    created_at: datetime
    paid_at: datetime | None = None
    attended_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    items: list[BookingItemOut] = []
    screening_info: BookingScreeningInfo | None = None


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rooftop_id: int
    token: str
    expires_at: datetime
    accepted_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime
