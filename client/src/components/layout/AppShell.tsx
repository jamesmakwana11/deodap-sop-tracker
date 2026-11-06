import { hasRole } from '@sop/shared';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../hooks/useApi';
import { formatRelative } from '../../lib/format';
import { useSync } from '../../sync/SyncContext';
import { Alert, Button } from '../ui/controls';

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-[14px] font-semibold ${isActive ? 'bg-head text-navy' : 'text-muted hover:text-navy'}`;

function SyncControl() {
  const { user } = useAuth();
  const { status, starting, start, error, clearError } = useSync();
  const running = status?.running;
  const last = status?.lastFinished;
  const canRefresh = hasRole(user, 'auditor');

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-[13px] text-muted md:inline" aria-live="polite">
        {running
          ? 'Refreshing from Meta…'
          : last
            ? `Last Meta refresh ${formatRelative(last.finishedAt ?? last.startedAt)}${last.status === 'succeeded' ? '' : ` (${last.status})`}`
            : 'No Meta refresh yet'}
      </span>
      {canRefresh && (
        <Button variant="secondary" onClick={() => void start()} disabled={Boolean(running) || starting}>
          {running || starting ? 'Refreshing…' : 'Refresh now'}
        </Button>
      )}
      {error && (
        <div className="fixed right-4 bottom-4 z-50 max-w-md" onClick={clearError}>
          <Alert>{error}</Alert>
        </div>
      )}
    </div>
  );
}

/** Everyone sees when the server's data storage is not safe; admins get a link to the details. */
function StorageBanner() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const state = useApi<{ persistence: 'ok' | 'warning' | 'error' }>(user ? '/system/health' : null);
  const level = state.data?.persistence;
  if (!level || level === 'ok') return null;
  const admin = hasRole(user, 'admin');
  return (
    <div role="alert" className={`border-b px-4 py-2 text-center text-[14px] sm:px-7 ${level === 'error' ? 'border-bad/40 bg-bad-bg text-bad' : 'border-avg/40 bg-avg-bg text-avg'}`}>
      {level === 'error'
        ? 'Data storage on the server is not safe: changes may not be saved or may be lost.'
        : 'Data on the server may be lost when the app is redeployed (no persistent storage detected).'}{' '}
      {admin ? (
        pathname !== '/settings' && (
          <Link to="/settings" className="font-semibold underline">
            See Data & backups
          </Link>
        )
      ) : (
        'Tell an admin.'
      )}
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  // A new page starts at the top (filters change the query string, not the path, and keep the position).
  // A block body: newer browsers return a value from scrollTo, which React would take as a cleanup function.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1880px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-7">
          <span className="font-serif text-lg font-semibold text-navy">DeoDap SOP</span>
          <div className="flex flex-wrap gap-1">
            <NavLink to="/" end className={link}>
              Dashboard
            </NavLink>
            <NavLink to="/history" className={link}>
              History
            </NavLink>
            <NavLink to="/settings" className={link}>
              Meta & schedule
            </NavLink>
            {hasRole(user, 'admin') && (
              <NavLink to="/users" className={link}>
                Users
              </NavLink>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <SyncControl />
            <span className="text-[13px] text-muted">
              {user?.name} · {user?.role}
            </span>
            <NavLink to="/account" className={link}>
              Password
            </NavLink>
            <Button variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </nav>
      <StorageBanner />
      <Outlet />
    </div>
  );
}
