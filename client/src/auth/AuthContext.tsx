import type { AuthUser } from '@sop/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onUnauthorized } from '../api/http';

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: AuthUser | null }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    // Any 401 (expired session, deactivated user) sends the person back to sign in.
    onUnauthorized(() => setUser(null));
    return () => onUnauthorized(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: AuthUser }>('/auth/login', { method: 'POST', body: { email, password } });
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const r = await api<{ user: AuthUser }>('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
    setUser(r.user);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, changePassword }), [user, loading, login, logout, changePassword]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
