import { hasRole, type Role } from '@sop/shared';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { Alert } from './components/ui/controls';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';
import { SyncProvider } from './sync/SyncContext';

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  if (!hasRole(user, role)) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <Alert>You need the {role} role to open this page. Ask an admin if you need access.</Alert>
      </main>
    );
  }
  return <>{children}</>;
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ChangePasswordPage forced />;

  return (
    <SyncProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="account" element={<ChangePasswordPage />} />
          <Route
            path="users"
            element={
              <RequireRole role="admin">
                <UsersPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SyncProvider>
  );
}

/** Everything below the router, so the same app can run under a different router (see src/preview). */
export function AppRoutes() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
