import { useContext } from 'react';
import { PortalAuthContext, type PortalAuthContextValue } from './portal-auth-context';

export function usePortalAuth(): PortalAuthContextValue {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) {
    throw new Error('usePortalAuth must be used inside <PortalAuthProvider>');
  }
  return ctx;
}
