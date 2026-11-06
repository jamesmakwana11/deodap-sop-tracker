import type { CheckOutcome, CheckResult } from '@sop/shared';

const GLYPH: Record<CheckOutcome, { glyph: string; className: string; label: string; legend: string }> = {
  PASS: { glyph: '✓', className: 'text-good', label: 'Passes', legend: 'passes' },
  FAIL: { glyph: '✗', className: 'text-bad font-semibold', label: 'Fails', legend: 'fails' },
  NOT_CHECKABLE: {
    glyph: '?',
    className: 'text-neutral',
    label: 'Not checkable from Meta data',
    legend: 'not checkable from Meta data',
  },
  NOT_APPLICABLE: { glyph: '–', className: 'text-slate-400', label: 'Not applicable', legend: 'not applicable' },
};

/** A missing result is shown as not checkable — never as a pass. */
export function checkTone(check: CheckResult | undefined) {
  return GLYPH[check?.outcome ?? 'NOT_CHECKABLE'];
}

export function CheckGlyph({ check }: { check: CheckResult | undefined }) {
  const tone = checkTone(check);
  const title = check?.detail ? `${tone.label}: ${check.detail}` : tone.label;
  return (
    <span className={tone.className} title={title} aria-label={title}>
      {tone.glyph}
    </span>
  );
}

export function CheckLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      {(Object.keys(GLYPH) as CheckOutcome[]).map((k) => (
        <span key={k}>
          <span className={GLYPH[k].className}>{GLYPH[k].glyph}</span> {GLYPH[k].legend}
        </span>
      ))}
    </div>
  );
}
