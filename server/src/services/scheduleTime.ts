import { env } from '../config/env.js';
import { getSetting } from '../repositories/metaRepository.js';

const IST_OFFSET_MS = 330 * 60_000; // IST has no daylight saving

/** Next occurrence of HH:MM IST strictly after `now`. */
export function nextRunAt(timeIst: string, now = new Date()): Date {
  const [h, m] = timeIst.split(':').map(Number) as [number, number];
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const candidate = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), h, m) - IST_OFFSET_MS;
  return new Date(candidate > now.getTime() ? candidate : candidate + 86_400_000);
}

/** IST calendar date (YYYY-MM-DD) for a moment, shifted by whole days. */
export function istDate(at: Date, addDays = 0): string {
  return new Date(at.getTime() + IST_OFFSET_MS + addDays * 86_400_000).toISOString().slice(0, 10);
}

export const SYNC_TIME_SETTING = 'sync_time_ist';

/** The admin's saved time wins over SYNC_TIME_IST. null means the daily sync is off. */
export async function getSyncTimeIst(): Promise<string | null> {
  const saved = await getSetting<{ time: string | null }>(SYNC_TIME_SETTING);
  if (saved) return saved.time;
  return env.SYNC_TIME_IST || null;
}
