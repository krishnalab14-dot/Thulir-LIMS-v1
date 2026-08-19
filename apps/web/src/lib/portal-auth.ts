/**
 * Stage 8: Portal auth state — patient and referrer sessions, kept SEPARATE
 * from staff auth (lib/auth.ts). Portal tokens carry `type: 'patient'` or
 * `type: 'referrer'` and must never mix with staff tokens.
 *
 * Same storage pattern as staff auth: access token in memory only (never
 * localStorage), refresh token in localStorage under a portal-specific key.
 */

import { API_BASE, ApiError, parseErrorBody } from './http';

export interface PatientPortalUser {
  id: string;
  organizationId: string;
  type: 'patient';
}

export interface ReferrerPortalUser {
  id: string;
  organizationId: string;
  type: 'referrer';
}

export type PortalUser = PatientPortalUser | ReferrerPortalUser;

interface PortalAuthResponse {
  accessToken: string;
  refreshToken: string;
  patient?: PatientPortalUser;
  referrer?: ReferrerPortalUser;
}

const PATIENT_REFRESH_KEY = 'thulir.portal.patient.refresh';
const REFERRER_REFRESH_KEY = 'thulir.portal.referrer.refresh';

let patientAccessToken: string | null = null;
let referrerAccessToken: string | null = null;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getPatientAccessToken(): string | null {
  return patientAccessToken;
}

export function getReferrerAccessToken(): string | null {
  return referrerAccessToken;
}

function getStoredRefresh(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredRefresh(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — session works until reload
  }
}

function clearStoredRefresh(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Patient portal auth
// ---------------------------------------------------------------------------

export function getPatientRefreshToken(): string | null {
  return getStoredRefresh(PATIENT_REFRESH_KEY);
}

export async function patientLogin(mobile: string, dob: string): Promise<PatientPortalUser> {
  const res = await fetch(`${API_BASE}/portal/patient/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile, dob }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const data = (await res.json()) as PortalAuthResponse;
  patientAccessToken = data.accessToken;
  setStoredRefresh(PATIENT_REFRESH_KEY, data.refreshToken);
  return data.patient!;
}

export async function patientRefreshSession(): Promise<PatientPortalUser> {
  const refreshToken = getPatientRefreshToken();
  if (!refreshToken) throw new ApiError(401, 'No refresh token');
  const res = await fetch(`${API_BASE}/portal/patient/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const data = (await res.json()) as PortalAuthResponse;
  patientAccessToken = data.accessToken;
  setStoredRefresh(PATIENT_REFRESH_KEY, data.refreshToken);
  return data.patient!;
}

export async function patientLogout(): Promise<void> {
  const refreshToken = getPatientRefreshToken();
  if (refreshToken && patientAccessToken) {
    try {
      await fetch(`${API_BASE}/portal/patient/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${patientAccessToken}` },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // best-effort
    }
  }
  patientAccessToken = null;
  clearStoredRefresh(PATIENT_REFRESH_KEY);
}

// ---------------------------------------------------------------------------
// Referrer portal auth
// ---------------------------------------------------------------------------

export function getReferrerRefreshToken(): string | null {
  return getStoredRefresh(REFERRER_REFRESH_KEY);
}

export async function referrerLogin(username: string, password: string): Promise<ReferrerPortalUser> {
  const res = await fetch(`${API_BASE}/portal/referrer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const data = (await res.json()) as PortalAuthResponse;
  referrerAccessToken = data.accessToken;
  setStoredRefresh(REFERRER_REFRESH_KEY, data.refreshToken);
  return data.referrer!;
}

export async function referrerRefreshSession(): Promise<ReferrerPortalUser> {
  const refreshToken = getReferrerRefreshToken();
  if (!refreshToken) throw new ApiError(401, 'No refresh token');
  const res = await fetch(`${API_BASE}/portal/referrer/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  const data = (await res.json()) as PortalAuthResponse;
  referrerAccessToken = data.accessToken;
  setStoredRefresh(REFERRER_REFRESH_KEY, data.refreshToken);
  return data.referrer!;
}

export async function referrerLogout(): Promise<void> {
  const refreshToken = getReferrerRefreshToken();
  if (refreshToken && referrerAccessToken) {
    try {
      await fetch(`${API_BASE}/portal/referrer/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${referrerAccessToken}` },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // best-effort
    }
  }
  referrerAccessToken = null;
  clearStoredRefresh(REFERRER_REFRESH_KEY);
}

// ---------------------------------------------------------------------------
// Portal API client (authenticated requests)
// ---------------------------------------------------------------------------

async function portalRequest<T>(
  path: string,
  getToken: () => string | null,
  refreshFn: () => Promise<PatientPortalUser | ReferrerPortalUser>,
  init: RequestInit = {},
  allowRetry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && allowRetry && (getPatientRefreshToken() || getReferrerRefreshToken())) {
    try {
      await refreshFn();
    } catch {
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    return portalRequest<T>(path, getToken, refreshFn, init, false);
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const patientApi = {
  get: <T>(path: string) =>
    portalRequest<T>(path, getPatientAccessToken, patientRefreshSession),
};

export const referrerApi = {
  get: <T>(path: string) =>
    portalRequest<T>(path, getReferrerAccessToken, referrerRefreshSession),
};
