import type { SyncStatusResponse } from '@sop/shared';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/http';

interface SyncValue {
  status: SyncStatusResponse | null;
  starting: boolean;
  error: string | null;
  /** Bumps whenever a run finishes, so pages can reload. */
  finishedVersion: number;
  start(): Promise<void>;
  clearError(): void;
}

const SyncContext = createContext<SyncValue | null>(null);

/** Polls the sync status: every 4 s while a run is going, every minute otherwise. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishedVersion, setFinishedVersion] = useState(0);
  const lastFinishedId = useRef<string | null | undefined>(undefined);
  const timer = useRef<number | null>(null);

  const poll = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    try {
      const s = await api<SyncStatusResponse>('/sync/status');
      setStatus(s);
      const finishedId = s.lastFinished?.id ?? null;
      if (lastFinishedId.current !== undefined && finishedId !== lastFinishedId.current) setFinishedVersion((v) => v + 1);
      lastFinishedId.current = finishedId;
      timer.current = window.setTimeout(poll, s.running ? 4000 : 60_000);
    } catch {
      timer.current = window.setTimeout(poll, 60_000);
    }
  }, []);

  useEffect(() => {
    void poll();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [poll]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await api('/sync', { method: 'POST' });
      await poll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }, [poll]);

  const clearError = useCallback(() => setError(null), []);
  return (
    <SyncContext.Provider value={{ status, starting, error, finishedVersion, start, clearError }}>{children}</SyncContext.Provider>
  );
}

export function useSync(): SyncValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
