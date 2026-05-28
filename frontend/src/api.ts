const TOKEN_KEY = "rc_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Ошибка ${res.status}`;
    throw new ApiError(typeof msg === "string" ? msg : JSON.stringify(msg), res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T = void>(p: string) => request<T>(p, { method: "DELETE" }),
  form: <T>(p: string, fields: Record<string, string>) => {
    const fd = new URLSearchParams(fields);
    return request<T>(p, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fd.toString(),
    });
  },
};

export type User = {
  id: number;
  email: string;
  full_name: string;
  role: "super_admin" | "admin" | "user";
  avatar_url: string | null;
  phone: string | null;
  social_url: string | null;
  bio: string | null;
  home_city_id: number | null;
  balance: number;
  is_email_verified: boolean;
  requires_initial_setup: boolean;
  permissions: string[] | null;
  created_at: string;
};

export type City = {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  is_active: boolean;
};

export type Rooftop = {
  id: number;
  city_id: number;
  name: string;
  address: string;
  description: string | null;
  cover_url: string | null;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
};

export type MovieStill = {
  id: number;
  image_url: string;
  position: number;
};

export type Movie = {
  id: number;
  title: string;
  original_title: string | null;
  description: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  trailer_url: string | null;
  duration_min: number | null;
  year: number | null;
  age_rating: string | null;
  genres: string | null;
  director: string | null;
  kinopoisk_id: number | null;
  imdb_id: string | null;
  imdb_rating: number | null;
  kinopoisk_rating: number | null;
  stills: MovieStill[];
};

export type RooftopPublic = {
  id: number;
  city_id: number;
  city_name: string;
  city_timezone: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  approx_lat: number | null;
  approx_lng: number | null;
  approx_radius_m: number;
  can_see_address: boolean;
};

export type SeatType = {
  id: number;
  rooftop_id: number;
  name: string;
  default_price: number;
  default_count: number;
  capacity: number;
  is_active: boolean;
};

export type ScreeningSeatType = {
  id: number;
  seat_type_id: number | null;
  name: string;
  price: number;
  count: number;
  capacity: number;
  seats_available: number;
};

export type ScreeningNotifySubscription = {
  id: number;
  screening_id: number;
  email: string;
  created_at: string;
  notified_at: string | null;
};

export type MessageTemplateKind =
  | "manual_booking"
  | "pre_booking_info"
  | "post_payment"
  | "post_show_receipt"
  | "payment_reminder"
  | "welcome_on_checkin"
  | "user_cancel_notice"
  | "admin_cancel_screening"
  | "refund_link"
  | "custom";

export type MessageTemplate = {
  id: number;
  kind: MessageTemplateKind;
  name: string;
  text: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export const TEMPLATE_KIND_LABELS: Record<MessageTemplateKind, string> = {
  manual_booking: "Ручное бронирование (до оплаты)",
  pre_booking_info: "Запрос данных у пользователя",
  post_payment: "После оплаты (с QR-кодом)",
  post_show_receipt: "Чек после показа (с вложением)",
  payment_reminder: "Напоминание об оплате (< 25% времени)",
  welcome_on_checkin: "Приветствие при check-in",
  user_cancel_notice: "Отмена брони (письмо пользователю)",
  admin_cancel_screening: "Отмена показа целиком",
  refund_link: "Возврат средств — ссылка на форму",
  custom: "Произвольный",
};

export type RefundRequestStatus = "created" | "filled" | "completed";

export type RefundRequest = {
  id: number;
  booking_id: number;
  status: RefundRequestStatus;
  amount: number;
  payout_full_name: string | null;
  payout_card_or_sbp: string | null;
  payout_bank: string | null;
  payout_comment: string | null;
  created_at: string;
  link_sent_at: string | null;
  filled_at: string | null;
  completed_at: string | null;
  payout_url: string;
  booking_full_name: string;
  booking_email: string;
  movie_title: string;
  screening_starts_at: string | null;
  rooftop_name: string;
};

export type RefundClaim = {
  status: RefundRequestStatus;
  amount: number;
  movie_title: string;
  screening_starts_at: string;
  rooftop_name: string;
  main_booker_name: string;
  payout_full_name: string | null;
  payout_card_or_sbp: string | null;
  payout_bank: string | null;
  payout_comment: string | null;
  completed_at: string | null;
};

export type UserSearchHit = {
  source: "user" | "booking_only";
  user_id: number | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  social_url: string | null;
  booking_count: number;
  last_booking_at: string | null;
};

export type PayoutTemplate = {
  id: number;
  name: string;
  recipient_name: string;
  card_number: string | null;
  phone: string | null;
  bank_name: string | null;
  note: string | null;
  is_default: boolean;
};

export type Screening = {
  id: number;
  movie_id: number;
  rooftop_id: number;
  starts_at: string;
  ends_at: string | null;
  booking_window_minutes: number;
  booking_opens_at: string | null;
  booking_closes_at: string | null;
  base_price: number;
  is_active: boolean;
  note: string | null;
  payout_template_id: number | null;
  movie: Movie;
  rooftop: Rooftop;
  seats: ScreeningSeatType[];
  payout_template: PayoutTemplate | null;
};

export type BookingStatus =
  | "waiting_payment" | "paid" | "attended" | "no_show"
  | "cancelled" | "expired" | "refund_pending" | "refunded" | "paid_by_balance";

export type BookingItem = {
  id: number;
  screening_seat_type_id: number | null;
  name: string;
  price_each: number;
  qty: number;
};

export type BookingScreeningInfo = {
  id: number;
  starts_at: string;
  /** Вычислено в роутере: явный ends_at или starts_at + movie.duration_min. */
  ends_at: string | null;
  movie_id: number;
  movie_title: string;
  movie_duration_min: number | null;
  movie_poster_url: string | null;
  rooftop_id: number;
  rooftop_name: string;
  city_name: string;
  /** IANA таймзона города (например, "Asia/Vladivostok") — для корректного отображения
   *  expires_at (хранится в UTC) и starts_at (хранится наивно в локальном времени крыши). */
  city_timezone: string;
  rooftop_address: string | null;
};

export type PaymentReceiptStatus = "pending" | "approved" | "rejected";

export type PaymentReceipt = {
  id: number;
  booking_id: number;
  image_url: string;
  status: PaymentReceiptStatus;
  amount_claimed: number | null;
  rejection_reason: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
};

export type PaymentReceiptAdmin = PaymentReceipt & {
  booking_full_name: string;
  booking_email: string;
  booking_total_amount: number;
  booking_balance_used: number;
  booking_status: BookingStatus;
  booking_short_code: string;
  screening_id: number;
  screening_starts_at: string;
  movie_title: string;
  rooftop_name: string;
};

export type BookingAttendee = {
  id: number;
  booking_id: number;
  email: string;
  full_name: string | null;
  guests_count: number;
  short_code: string;
  qr_token: string;
  claim_url: string;
  claimed_by_user_id: number | null;
  claimed_at: string | null;
  notified_at: string | null;
  created_at: string;
};

export type ClaimInfo = {
  attendee_id: number;
  email: string;
  full_name: string | null;
  guests_count: number;
  short_code: string | null;
  qr_token: string | null;
  is_paid: boolean;
  booking_status: BookingStatus;
  main_booker_full_name: string;
  movie_title: string;
  movie_poster_url: string | null;
  screening_starts_at: string;
  rooftop_name: string;
  city_name: string;
  rooftop_address: string | null;
  claimed_by_user_id: number | null;
  claimed_at: string | null;
};

// === Возврат средств (для страницы брони пользователя) ===

export type RefundBasic = {
  id: number;
  status: "created" | "filled" | "completed";
  amount: number;
  payout_token: string;   // → /refund/{token}
  link_sent_at: string | null;
  filled_at: string | null;
  completed_at: string | null;
};

// === Check-in (Этап F) ===

export type CheckInSeatItem = {
  name: string;
  qty: number;
};

export type CheckInInfo = {
  kind: "booking" | "attendee";
  booking_id: number;
  attendee_id: number | null;
  full_name: string;
  guests_count: number;
  seat_breakdown: CheckInSeatItem[];
  movie_title: string;
  screening_id: number;
  screening_starts_at_iso: string;
  screening_starts_at_fmt: string;
  rooftop_name: string;
  booking_status: string;
  already_attended: boolean;
  can_check_in: boolean;
  reason: string | null;
};

export type CheckInConfirmOut = {
  ok: boolean;
  booking_id: number;
  attendee_id: number | null;
  already_attended: boolean;
};

export type PostShowReceiptInfo = {
  id: number;
  file_url: string;
  sent_at: string | null;
  created_at: string;
};

export type Booking = {
  id: number;
  user_id: number | null;
  screening_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  social_url: string | null;
  status: BookingStatus;
  expires_at: string;
  total_amount: number;
  balance_used: number;
  qr_token: string;
  short_code: string;
  note: string | null;
  needs_post_show_receipt: boolean;
  created_at: string;
  paid_at: string | null;
  attended_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  items: BookingItem[];
  screening_info: BookingScreeningInfo | null;
  receipts: PaymentReceipt[];
  attendees: BookingAttendee[];
  total_guests: number;
  refund_request: RefundBasic | null;
  post_show_receipt: PostShowReceiptInfo | null;
};
