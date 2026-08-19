import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PortalUser } from '../lib/portal-auth';
import {
  getPatientRefreshToken,
  getReferrerRefreshToken,
  patientLogout,
  patientRefreshSession,
  referrerLogout,
  referrerRefreshSession,
} from '../lib/portal-auth';
import { PortalAuthContext, type PortalAuthContextValue } from './portal-auth-context';

/**
 * Stage 8: Portal auth provider — bootstraps from a stored refresh token
 * on mount (same silent-refresh pattern as staff AuthProvider). Supports
 * either a patient or referrer session — determined by which refresh token
 * key is populated in localStorage.
 */
export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [portalUser, setPortalUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalType, setPortalType] = useState<'patient' | 'referrer' | null>(null);

  // Silent refresh on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (getPatientRefreshToken()) {
          const user = await patientRefreshSession();
          if (!cancelled) {
            setPortalUser(user);
            setPortalType('patient');
          }
        } else if (getReferrerRefreshToken()) {
          const user = await referrerRefreshSession();
          if (!cancelled) {
            setPortalUser(user);
            setPortalType('referrer');
          }
        }
      } catch {
        // Invalid/expired — clear both
        await patientLogout();
        await referrerLogout();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (_credentials: Record<string, string>) => {
    // Login is handled by the page directly (patient vs referrer have
    // different login forms and different API calls). The page calls the
    // appropriate login function and then sets the user via the context.
    // This callback is a placeholder — the real login happens in the page.
  }, []);

  const logout = useCallback(async () => {
    if (portalType === 'patient') {
      await patientLogout();
    } else if (portalType === 'referrer') {
      await referrerLogout();
    }
    setPortalUser(null);
    setPortalType(null);
  }, [portalType]);

  const value = useMemo<PortalAuthContextValue>(
    () => ({ portalUser, loading, login, logout }),
    [portalUser, loading, login, logout],
  );

  return (
    <PortalAuthContext.Provider value={value}>
      {children}
    </PortalAuthContext.Provider>
  );
}
