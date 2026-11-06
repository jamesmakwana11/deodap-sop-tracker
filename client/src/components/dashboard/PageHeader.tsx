import type { AuditRunInfo } from '@sop/shared';
import type { ReactNode } from 'react';
import { PERFORMANCE_WINDOW_DAYS } from '@sop/shared';
import { formatIst, joinWithAnd } from '../../lib/format';

export function PageHeader({ run, action }: { run: AuditRunInfo | null; action?: ReactNode }) {
  return (
    <header className="rounded-2xl border border-line bg-hero px-6 py-6 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-navy sm:text-[38px]">
          DeoDap SOP Campaign Tracker
        </h1>
        {action}
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {run ? (
          <>
            Updated {formatIst(run.finishedAt ?? run.startedAt)}. Active campaigns in the{' '}
            {joinWithAnd(run.accounts.map((a) => `${a.name} (${a.metaAccountId})`))} Meta ad{' '}
            {run.accounts.length === 1 ? 'account' : 'accounts'}. Performance is the last {PERFORMANCE_WINDOW_DAYS} days;
            settings are as they stand at the update time.
          </>
        ) : (
          'No audit has run yet. Once Meta ad accounts are connected, active campaigns are checked against the SOP here.'
        )}
      </p>
    </header>
  );
}
