import type { RunListItem, SyncStatusResponse } from '@sop/shared';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/http';

export interface SyncNotice {
  tone: 'success' | 'warn' | 'error';
  title: string;
  lines: string[];
}

export const SUCCESS_MESSAGE = 'Meta data loaded successfully. Please check your Dashboard.';

/** What to tell the person when a refresh finishes. A partial or failed run is never shown as a success. */
export function noticeFor(run: RunListItem): SyncNotice {
  const failed = run.accounts.filter((a) => a.status === 'failed');
  const loaded = run.accounts.filter((a) => a.status === 'succeeded');
  if (run.status === 'succeeded') return { tone: 'success', title: SUCCESS_MESSAGE, lines: [] };
  if (run.status === 'partial') {
    return {
      tone: 'warn',
      title: `Meta data loaded for ${loaded.map((a) => a.name).join(', ') || 'some accounts'} only. ${failed.length === 1 ? 'One account' : `${failed.length} accounts`} failed:`,
      lines: failed.length ? failed.map((a) => `${a.name}: ${a.error ?? 'unknown error'}`) : [run.error ?? 'Unknown error'],
    };
  }
  return {
    tone: 'error',
    title: 'Meta refresh failed. The Dashboard still shows the last successful refresh.',
    lines: failed.length ? failed.map((a) => `${a.name}: ${a.error ?? 'unknown error'}`) : [run.error ?? 'Unknown error'],
  };
}

interface SyncValue {
  status: SyncStatusResponse | null;
  starting: boolean;
  error: string | null;
  /** Bumps whenever a run finishes, so pages can reload. */
  finishedVersion: number;
  /** Shown when a refresh finishes (success, partial or failed). */
  notice: SyncNotice | null;
  start(): Promise<void>;
  clearError(): void;
  clearNotice(): void;
}

const SyncContext = createContext<SyncValue | null>(null);

/** Polls the sync status: every 3 s while a run is going, every minute otherwise. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishedVersion, setFinishedVersion] = useState(0);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const lastFinishedId = useRef<string | null | undefined>(undefined);
  const timer = useRef<number | null>(null);

  const poll = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    try {
      const s = await api<SyncStatusResponse>('/sync/status');
      setStatus(s);
      const finishedId = s.lastFinished?.id ?? null;
      if (lastFinishedId.current !== undefined && finishedId !== lastFinishedId.current) {
        setFinishedVersion((v) => v + 1);
        if (s.lastFinished) setNotice(noticeFor(s.lastFinished));
      }
      lastFinishedId.current = finishedId;
      timer.current = window.setTimeout(poll, s.running ? 3000 : 60_000);
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
    setNotice(null);
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
  const clearNotice = useCallback(() => setNotice(null), []);
  return (
    <SyncContext.Provider value={{ status, starting, error, finishedVersion, notice, start, clearError, clearNotice }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
