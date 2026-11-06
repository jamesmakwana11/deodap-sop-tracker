import { EXPORT_FORMAT_LABEL, type GeneratedReportInfo } from '@sop/shared';
import { useEffect, useState } from 'react';
import { downloadFile } from '../../api/http';
import { useApi } from '../../hooks/useApi';
import { formatBytes, formatIst } from '../../lib/format';
import { EXPORTED_EVENT } from '../ui/ExportMenu';

/** Files generated earlier and kept on the server; each can be downloaded again. */
export function RecentExports({ isAdmin }: { isAdmin: boolean }) {
  const state = useApi<{ reports: GeneratedReportInfo[] }>('/exports/history');
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { reload } = state;
  useEffect(() => {
    window.addEventListener(EXPORTED_EVENT, reload);
    return () => window.removeEventListener(EXPORTED_EVENT, reload);
  }, [reload]);

  if (state.status === 'error') return <p className="text-[14px] text-bad">{state.error}</p>;
  if (!state.data) return <p className="text-[14px] text-muted">Loading…</p>;
  const reports = state.data.reports;
  if (!reports.length) return <p className="text-[14px] text-muted">No exports yet. Files you download from any Export button are kept here.</p>;

  return (
    <div className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-[13px] text-bad">{error}</p>}
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="bg-head text-left text-navy">
            {['Report', 'Format', 'Records', 'Created', ...(isAdmin ? ['By'] : []), 'Size', ''].map((h) => (
              <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(showAll ? reports : reports.slice(0, 10)).map((r) => (
            <tr key={r.id} className="border-b border-line">
              <td className="px-2.5 py-2">
                {r.title}
                {r.devData && <span className="ml-2 text-[12px] font-semibold text-bad">Development data</span>}
                <div className="text-[12px] break-all text-muted">{r.fileName}</div>
              </td>
              <td className="px-2.5 py-2 whitespace-nowrap">{EXPORT_FORMAT_LABEL[r.format]}</td>
              <td className="px-2.5 py-2 whitespace-nowrap">{r.scope === 'all' ? 'All records' : 'Selected'}</td>
              <td className="px-2.5 py-2 whitespace-nowrap">{formatIst(r.createdAt)}</td>
              {isAdmin && <td className="px-2.5 py-2 whitespace-nowrap">{r.createdBy ?? '–'}</td>}
              <td className="px-2.5 py-2 whitespace-nowrap tabular-nums">{formatBytes(r.size)}</td>
              <td className="px-2.5 py-2">
                <button
                  type="button"
                  className="font-semibold text-brand hover:underline"
                  onClick={() => {
                    setError(null);
                    downloadFile(`/exports/files/${r.id}`, r.fileName).catch((e: Error) => {
                      setError(e.message);
                      reload();
                    });
                  }}
                >
                  Download
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {reports.length > 10 && (
        <button type="button" className="mt-2 text-[14px] font-semibold text-brand hover:underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show the latest 10' : `Show all ${reports.length}`}
        </button>
      )}
    </div>
  );
}
