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
  is_active: boolean;
};

export type ScreeningSeatType = {
  id: number;
  seat_type_id: number | null;
  name: string;
  price: number;
  count: number;
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
  booking_window_minutes: number;
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
  movie_id: number;
  movie_title: string;
  movie_poster_url: string | null;
  rooftop_id: number;
  rooftop_name: string;
  city_name: string;
  rooftop_address: string | null;
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
  created_at: string;
  paid_at: string | null;
  attended_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  items: BookingItem[];
  screening_info: BookingScreeningInfo | null;
};
