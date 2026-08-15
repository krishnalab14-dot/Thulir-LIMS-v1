import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { clearSession, getRefreshToken, loginUser, logoutUser, refreshSession, setUnauthorizedHandler } from '../lib/auth';
import type { AuthUser } from '../lib/auth';
import { AuthContext } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setUnauthorizedHandler(() => setUser(null));
    (async () => {
      try {
        if (getRefreshToken()) {
          const session = await refreshSession();
          if (!cancelled) {
            setUser(session.user);
          }
        }
      } catch {
        clearSession();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await loginUser(username, password);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await logoutUser();
    setUser(null);
  }, []);

  const value = useMemo(() => {
    const role = user?.role;
    return {
      user,
      loading,
      login,
      logout,
      canVerify: role === 'admin' || role === 'lab_manager' || role === 'technician',
      canApprove: role === 'admin' || role === 'lab_manager' || role === 'pathologist',
      canManageMasters: role === 'admin',
      canCreateUsers: role === 'admin',
    };
  }, [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
