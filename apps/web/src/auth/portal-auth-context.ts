import { createContext } from 'react';
import type { PortalUser } from '../lib/portal-auth';

/**
 * Stage 8: Portal auth context — separate from staff AuthContext. Each portal
 * (patient / referrer) has its own session lifecycle, stored in its own
 * localStorage key, with its own access token in memory. The two never mix.
 */
export interface PortalAuthContextValue {
  portalUser: PortalUser | null;
  loading: boolean;
  login: (credentials: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
}

export const PortalAuthContext = createContext<PortalAuthContextValue | null>(null);
