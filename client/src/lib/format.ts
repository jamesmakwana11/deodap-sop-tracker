// Formatting lives in @sop/shared so the screen and the PDF/Excel reports match.
export { formatDate, formatIst, formatMainMetric, formatPercent, formatRupees, joinWithAnd } from '@sop/shared';

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 minutes ago", "in 5 hours" */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return relative.format(Math.round(diff), 'second');
  if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(diff / 3600), 'hour');
  return relative.format(Math.round(diff / 86400), 'day');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Today's date in India as YYYY-MM-DD (for date inputs). */
export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
