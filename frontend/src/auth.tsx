import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken, type User } from "./api";

type LoginChallenge = {
  mfa_token: string;
  expires_in: number;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  /** Шаг 1: проверяет логин/пароль, возвращает mfa_token для шага 2. */
  login: (email: string, password: string) => Promise<LoginChallenge>;
  /** Шаг 2: подтверждает OTP-код, устанавливает сессию. */
  verifyLogin: (mfa_token: string, code: string) => Promise<void>;
  register: (data: RegisterPayload) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Проверяет наличие права у текущего пользователя.
   *  super_admin — всегда true; admin с permissions=null — true (legacy);
   *  admin с конкретным списком — perm должен быть в нём; user/null — false. */
  hasPerm: (perm: string) => boolean;
};

type RegisterPayload = {
  email: string;
  password: string;
  full_name: string;
  home_city_id: number | null;
  pd_consent: boolean;
};

const AuthCtx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const u = await api.get<User>("/api/auth/me");
      setUser(u);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string): Promise<LoginChallenge> => {
    return await api.post<LoginChallenge>("/api/auth/login-json", { email, password });
  }, []);

  const verifyLogin = useCallback(async (mfa_token: string, code: string) => {
    const { access_token } = await api.post<{ access_token: string }>("/api/auth/login-verify", {
      mfa_token,
      code,
    });
    setToken(access_token);
    await refresh();
  }, [refresh]);

  const register = useCallback(async (data: RegisterPayload) => {
    const { access_token } = await api.post<{ access_token: string }>("/api/auth/register", data);
    setToken(access_token);
    await refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const hasPerm = useCallback((perm: string): boolean => {
    if (!user) return false;
    if (user.role === "super_admin") return true;
    if (user.role !== "admin") return false;
    if (user.permissions === null) return true; // legacy admin — all rights
    return user.permissions.includes(perm);
  }, [user]);

  return (
    <AuthCtx.Provider value={{ user, loading, login, verifyLogin, register, logout, refresh, hasPerm }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
