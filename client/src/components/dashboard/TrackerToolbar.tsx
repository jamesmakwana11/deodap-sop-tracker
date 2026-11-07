import {
  OBJECTIVES,
  RATING_LABEL,
  RATINGS,
  SOP_STATUS_LABEL,
  SOP_STATUSES,
  SORT_OPTIONS,
  type AccountRef,
  type SortKey,
  type TrackerFilters,
} from '@sop/shared';
import { ExportMenu } from '../ui/ExportMenu';
import { Field, Input, Select } from '../ui/controls';

export interface TrackerQuery extends TrackerFilters {
  sort: SortKey;
}

/** Turns the tracker query into URL params (also used for the report downloads). */
export function toSearchParams(q: TrackerQuery, extra: Record<string, string | undefined> = {}): URLSearchParams {
  const p = new URLSearchParams();
  const entries: [string, string | undefined][] = [
    ['accountId', q.accountId],
    ['rating', q.rating],
    ['objective', q.objective],
    ['sopStatus', q.sopStatus],
    ['search', q.search?.trim() || undefined],
    ['activity', q.activity],
    ['sort', q.sort === 'spend_desc' ? undefined : q.sort],
    ...Object.entries(extra),
  ];
  for (const [k, v] of entries) if (v) p.set(k, v);
  return p;
}

export function TrackerToolbar({
  query,
  onChange,
  accounts,
  objectives,
  exportParams,
}: {
  query: TrackerQuery;
  onChange: (q: TrackerQuery) => void;
  accounts: AccountRef[];
  objectives: string[];
  /** Run and filters for the export (the filters shown here). */
  exportParams: Record<string, string | undefined>;
}) {
  const set = <K extends keyof TrackerQuery>(key: K, value: TrackerQuery[K] | '') =>
    onChange({ ...query, [key]: value === '' ? undefined : value });
  const objectiveOptions = [...OBJECTIVES, 'Other'].filter((o) => objectives.includes(o));

  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <Field label="Search">
        <Input
          type="search"
          placeholder="Campaign name or ID"
          value={query.search ?? ''}
          onChange={(e) => set('search', e.target.value)}
          className="w-56"
        />
      </Field>
      <Field label="Show">
        <Select value={query.activity ?? ''} onChange={(e) => set('activity', e.target.value as TrackerQuery['activity'])}>
          <option value="">Active campaigns</option>
          <option value="all">All with campaign status Active</option>
        </Select>
      </Field>
      <Field label="Account">
        <Select value={query.accountId ?? ''} onChange={(e) => set('accountId', e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Rating">
        <Select value={query.rating ?? ''} onChange={(e) => set('rating', e.target.value as TrackerQuery['rating'])}>
          <option value="">All ratings</option>
          {RATINGS.map((r) => (
            <option key={r} value={r}>
              {RATING_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Objective">
        <Select value={query.objective ?? ''} onChange={(e) => set('objective', e.target.value as TrackerQuery['objective'])}>
          <option value="">All objectives</option>
          {objectiveOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="SOP status">
        <Select value={query.sopStatus ?? ''} onChange={(e) => set('sopStatus', e.target.value as TrackerQuery['sopStatus'])}>
          <option value="">All</option>
          {SOP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SOP_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Sort by">
        <Select value={query.sort} onChange={(e) => set('sort', e.target.value as SortKey)}>
          {(Object.keys(SORT_OPTIONS) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_OPTIONS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="ml-auto">
        <ExportMenu datasets={['tracker', 'performance', 'failed', 'manual', 'creatives', 'adsets']} params={exportParams} />
      </div>
    </div>
  );
}
