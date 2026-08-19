import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { usePortalAuth } from '../auth/usePortalAuth';

/**
 * Stage 8: Protects portal routes — while auth state bootstraps from the
 * stored refresh token, a calm loader is shown; once resolved, unauthenticated
 * users are sent to the specified redirectTo path.
 */
export function RequirePortalAuth({
  children,
  redirectTo = '/portal/patient/login',
}: {
  children: ReactNode;
  redirectTo?: string;
}) {
  const { portalUser, loading } = usePortalAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <p className="text-sm font-medium text-slate-500">Signing you in…</p>
      </div>
    );
  }

  if (!portalUser) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
