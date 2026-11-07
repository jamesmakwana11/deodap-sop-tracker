import { purgeExpiredSessions } from '../auth/sessions.js';
import { store } from '../storage/store.js';
import { HttpError } from '../http/errors.js';
import { getSyncTimeIst, nextRunAt } from './scheduleTime.js';
import { dailyBackupIfDue } from './storageStatus.js';
import { closeInterruptedRuns, startSync } from './syncService.js';

/**
 * Daily sync. Every minute it checks whether today's scheduled time (IST) has passed with no
 * scheduled run since then — which also catches up after downtime. The admin can change the
 * time in Settings without a restart.
 */

const TICK_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let busy = false;

/** Today's due moment: the most recent occurrence of HH:MM IST at or before now. */
function lastDue(timeIst: string, now: Date): Date {
  const next = nextRunAt(timeIst, now);
  return new Date(next.getTime() - 86_400_000);
}

export async function tick(now = new Date()): Promise<'ran' | 'idle'> {
  if (busy) return 'idle';
  busy = true;
  try {
    await dailyBackupIfDue(now.getTime()).catch((err) => console.error('Daily backup failed', err));
    const time = await getSyncTimeIst();
    if (!time) return 'idle';
    const due = lastDue(time, now);
    const ranSinceDue = store.c.auditRuns.find(
      (r) => r.source === 'meta' && r.trigger === 'scheduled' && Date.parse(r.startedAt) >= due.getTime(),
    );
    if (ranSinceDue) return 'idle';
    try {
      const { runId, done } = await startSync({ trigger: 'scheduled', now });
      console.log(`Scheduled Meta sync started (run ${runId})`);
      await done;
      await purgeExpiredSessions();
      return 'ran';
    } catch (err) {
      // No accounts selected yet, or a manual refresh is already running: try again next tick.
      if (err instanceof HttpError) return 'idle';
      throw err;
    }
  } finally {
    busy = false;
  }
}

export function startScheduler(): void {
  if (timer) return;
  void closeInterruptedRuns().then((n) => n && console.log(`Handled ${n} sync run(s) cut off by a restart`));
  const loop = () => tick().catch((err) => console.error('Scheduler tick failed', err));
  timer = setInterval(loop, TICK_MS);
  timer.unref();
  void loop();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
