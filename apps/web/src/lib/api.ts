import { clearSession, getAccessToken, getRefreshToken, notifyUnauthorized, refreshSession } from './auth';
import { API_BASE, ApiError, parseErrorBody } from './http';

export { ApiError } from './http';

/**
 * Stage 7: the retired `x-organization-id` header is GONE. Tenant context now
 * comes from the access token (`Authorization: Bearer …`). On a 401 the
 * client transparently rotates the refresh token once and retries the request;
 * a failed rotation clears the session and notifies the AuthProvider so the
 * UI redirects to /login.
 */
async function request<T>(path: string, init: RequestInit = {}, allowRetry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && allowRetry && getRefreshToken()) {
    try {
      await refreshSession();
    } catch {
      clearSession();
      notifyUnauthorized();
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    return request<T>(path, init, false);
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
};
