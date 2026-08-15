import { API_BASE, ApiError, parseErrorBody } from './http';

/**
 * Stage 7 auth state.
 *
 * Token storage decision (documented per the stage spec): the short-lived
 * ACCESS token lives ONLY in memory (module variable) — it is never written
 * to localStorage, so an XSS-able storage read cannot exfiltrate a live
 * session. The longer-lived REFRESH token is stored in localStorage — the
 * reasonably-secure fallback the spec allows when the backend does not set
 * httpOnly cookies (CORS + the existing header-based API client make a cookie
 * flip a larger change than this stage's scope). On every 401 the API client
 * transparently rotates the refresh token and retries; a failed rotation
 * clears the session and bounces to /login.
 */
export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'lab_manager' | 'pathologist' | 'technician' | 'receptionist';
  organizationId: string;
}

const REFRESH_KEY = 'thulir.refreshToken';

let accessToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setSession(access: string, refresh: string): void {
  accessToken = access;
  try {
    localStorage.setItem(REFRESH_KEY, refresh);
  } catch {
    // storage unavailable (private mode) — session still works until reload
  }
}

export function clearSession(): void {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    // ignore
  }
}

/** The AuthProvider registers this so a failed silent refresh can reset UI state. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  return (await res.json()) as T;
}

/** Exchanges the stored refresh token for a fresh pair + user (rotating the refresh token). */
export async function refreshSession(): Promise<AuthResponse> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new ApiError(401, 'No refresh token');
  }
  const session = await postJson<AuthResponse>('/auth/refresh', { refreshToken });
  setSession(session.accessToken, session.refreshToken);
  return session;
}

/** POST /auth/login — stores the token pair on success and returns the user. */
export async function loginUser(username: string, password: string): Promise<AuthUser> {
  const session = await postJson<AuthResponse>('/auth/login', { username, password });
  setSession(session.accessToken, session.refreshToken);
  return session.user;
}

/** POST /auth/logout (best-effort) then clears local auth state. */
export async function logoutUser(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken && getAccessToken()) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAccessToken()}` },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // best-effort — local state is cleared regardless
    }
  }
  clearSession();
}
