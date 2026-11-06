import { EXPORT_DATASETS, EXPORT_FORMAT_LABEL, EXPORT_FORMATS, type ExportDatasetId, type ExportFormat } from '@sop/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { downloadFile } from '../../api/http';
import { reportsAvailable } from '../../lib/reports';

/** Fired after a successful export, so lists of recent exports can refresh. */
export const EXPORTED_EVENT = 'sop:exported';

/**
 * "Export" button with a small panel: pick the report (when there are several), the format
 * and whether to use the current filters or every record, then download. The file is built
 * on the server, which also keeps a copy under History → Recent exports.
 */
export function ExportMenu({
  datasets,
  params,
  label = 'Export',
  align = 'right',
  hideScope = false,
}: {
  datasets: ExportDatasetId[];
  /** Current filters, run, campaign or date range, sent as query parameters. */
  params: Record<string, string | null | undefined>;
  label?: string;
  align?: 'left' | 'right';
  hideScope?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dataset, setDataset] = useState<ExportDatasetId>(datasets[0]!);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [scope, setScope] = useState<'filtered' | 'all'>('filtered');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const info = EXPORT_DATASETS[dataset];
  const scopeChoice = !hideScope && info.filteredLabel !== info.allLabel;

  async function download() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
      if (scopeChoice && scope === 'all') q.set('scope', 'all');
      const qs = q.toString();
      const name = await downloadFile(`/exports/${dataset}.${format}${qs ? `?${qs}` : ''}`);
      setDone(name);
      window.dispatchEvent(new CustomEvent(EXPORTED_EVENT));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!reportsAvailable) {
    return (
      <button type="button" disabled title="Downloads work in the installed app" className="inline-flex h-9 cursor-not-allowed items-center rounded-lg bg-white px-3.5 text-[14px] font-semibold text-muted ring-1 ring-line">
        {label}
      </button>
    );
  }

  return (
    <div ref={box} className="relative inline-block text-left">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
          setDone(null);
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3.5 text-[14px] font-semibold text-navy ring-1 ring-line hover:bg-head/60"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M8 2v8m0 0L5 7m3 3 3-3M3 12.5h10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`${label} options`}
          className={`absolute z-30 mt-2 w-[320px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-white p-4 shadow-[0_8px_30px_rgba(20,48,107,0.14)] ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {datasets.length > 1 ? (
            <label className="flex flex-col gap-1 text-[13px] text-muted">
              Report
              <select
                value={dataset}
                onChange={(e) => setDataset(e.target.value as ExportDatasetId)}
                className="h-9 rounded-lg border border-line bg-white px-2.5 text-[14px] text-ink outline-none focus:border-brand"
              >
                {datasets.map((d) => (
                  <option key={d} value={d}>
                    {EXPORT_DATASETS[d].title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="text-[14px] font-semibold text-navy">{info.title}</div>
          )}
          <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{info.description}</p>

          <fieldset className="mt-3">
            <legend className="text-[13px] text-muted">Format</legend>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {EXPORT_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={format === f}
                  onClick={() => setFormat(f)}
                  className={`h-8 rounded-lg text-[13px] font-semibold ring-1 ${format === f ? 'bg-brand text-white ring-brand' : 'bg-white text-navy ring-line hover:bg-head/60'}`}
                >
                  {EXPORT_FORMAT_LABEL[f]}
                </button>
              ))}
            </div>
          </fieldset>

          {scopeChoice && (
            <fieldset className="mt-3 text-[14px] text-ink">
              <legend className="text-[13px] text-muted">Records</legend>
              {(['filtered', 'all'] as const).map((s) => (
                <label key={s} className="mt-1 flex items-center gap-2">
                  <input type="radio" name={`${panelId}-scope`} checked={scope === s} onChange={() => setScope(s)} />
                  {s === 'filtered' ? info.filteredLabel : info.allLabel}
                </label>
              ))}
            </fieldset>
          )}

          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg bg-brand text-[14px] font-semibold text-white hover:bg-[#1d4fd8] disabled:bg-brand/50"
          >
            {busy ? 'Preparing file…' : `Download ${EXPORT_FORMAT_LABEL[format]}`}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-[13px] text-bad">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="mt-2 break-all text-[13px] text-good">
              Downloaded {done}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
