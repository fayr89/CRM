// Лёгкий клиент к Express-бэкенду (crm-backend). Адрес берётся из NEXT_PUBLIC_API_URL.
// Токен и пользователь хранятся в localStorage; токен подставляется в заголовок Authorization.

const RAW_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
export const API_BASE = RAW_BASE.replace(/\/+$/, "");

const TOKEN_KEY = "crm_token";
const USER_KEY = "crm_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser<T = unknown>(): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: unknown): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(
      "Бэкенд не настроен: переменная NEXT_PUBLIC_API_URL пуста.",
      0,
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      "Не удалось соединиться с сервером. Проверьте подключение и адрес API.",
      0,
    );
  }

  if (res.status === 401) {
    clearAuth();
    if (
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login")
    ) {
      window.location.href = "/login";
    }
    throw new ApiError("Сессия истекла — войдите заново.", 401);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const errObj = body as { error?: string; message?: string } | null;
    const msg =
      (errObj && (errObj.error || errObj.message)) || `Ошибка ${res.status}`;
    throw new ApiError(typeof msg === "string" ? msg : `Ошибка ${res.status}`, res.status);
  }

  return body as T;
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  del: <T = unknown>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
