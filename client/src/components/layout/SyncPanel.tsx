import type { SyncProgress } from '@sop/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSync, type SyncNotice } from '../../sync/SyncContext';

const TONE: Record<SyncNotice['tone'], string> = {
  success: 'border-good/40 bg-good-bg text-good',
  warn: 'border-avg/40 bg-avg-bg text-avg',
  error: 'border-bad/40 bg-bad-bg text-bad',
};

function Spinner() {
  return <span aria-hidden className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />;
}

/** Seconds left until a Meta wait ends, ticking every second. */
function useSecondsLeft(until: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  if (!until) return null;
  return Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
}

function ProgressCard({ progress }: { progress: SyncProgress | null }) {
  const left = useSecondsLeft(progress?.waitingUntil ?? null);
  const finished = progress ? progress.doneAccounts.length + progress.failedAccounts.length : 0;
  // Each account counts as one step, plus the final save; at least a sliver so the bar is visible.
  const pct = progress ? Math.max(4, Math.round((finished / (progress.accountCount + 1)) * 100)) : 4;
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-line bg-white px-4 py-3 text-[14px] shadow-lg">
      <div className="flex items-center gap-2 font-semibold text-navy">
        <Spinner />
        Loading Meta data…
      </div>
      {progress && (
        <div className="mt-1.5 space-y-0.5 text-[13px] text-muted">
          {progress.accountName && (
            <p>
              Account {progress.accountIndex} of {progress.accountCount}: <b className="text-ink">{progress.accountName}</b>
            </p>
          )}
          <p>{progress.step}</p>
          {progress.waitingMessage && (
            <p className="text-avg">
              {progress.waitingMessage}
              {left !== null && left > 0 ? ` (${left >= 90 ? `${Math.floor(left / 60)} min ${left % 60} s` : `${left} s`} left)` : ''}
            </p>
          )}
          {progress.failedAccounts.length > 0 && <p className="text-bad">Failed so far: {progress.failedAccounts.map((f) => f.name).join(', ')}</p>}
        </div>
      )}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-head" aria-hidden>
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[12px] text-muted">You can keep working; the Dashboard updates when this finishes.</p>
    </div>
  );
}

function NoticeCard({ notice, onClose }: { notice: SyncNotice; onClose: () => void }) {
  // A success hides itself after a while; problems stay until dismissed.
  useEffect(() => {
    if (notice.tone !== 'success') return;
    const t = window.setTimeout(onClose, 15_000);
    return () => window.clearTimeout(t);
  }, [notice, onClose]);
  return (
    <div role={notice.tone === 'success' ? 'status' : 'alert'} className={`rounded-xl border px-4 py-3 text-[14px] shadow-lg ${TONE[notice.tone]}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{notice.title}</p>
          {notice.lines.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] break-words">
              {notice.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {notice.tone !== 'error' && (
            <Link to="/" onClick={onClose} className="mt-1 inline-block text-[13px] font-semibold underline">
              Open Dashboard
            </Link>
          )}
        </div>
        <button type="button" onClick={onClose} className="-mr-1 shrink-0 rounded px-1 text-[18px] leading-none opacity-70 hover:opacity-100" aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}

/** Bottom-right: progress while a Meta refresh runs, then the outcome. */
export function SyncPanel() {
  const { status, starting, notice, clearNotice } = useSync();
  const running = Boolean(status?.running) || starting;
  if (!running && !notice) return null;
  return (
    <div className="fixed right-4 bottom-4 left-4 z-50 sm:left-auto sm:w-[400px]">
      {running ? <ProgressCard progress={status?.progress ?? null} /> : notice && <NoticeCard notice={notice} onClose={clearNotice} />}
    </div>
  );
}
