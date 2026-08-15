import { createContext } from 'react';
import type { AuthUser } from '../lib/auth';

export interface AuthContextValue {
  user: AuthUser | null;
  /** True while the app is bootstrapping auth state from a stored refresh token. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Role-based capability helpers mirroring the backend @Roles gates (UX only — the API enforces). */
  canVerify: boolean;
  canApprove: boolean;
  canManageMasters: boolean;
  canCreateUsers: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
