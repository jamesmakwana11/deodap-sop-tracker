import type { StorageStatus } from '@sop/shared';
import { useState } from 'react';
import { api } from '../../api/http';
import { useApi } from '../../hooks/useApi';
import { formatBytes, formatIst } from '../../lib/format';
import { Card } from '../ui/Card';
import { Alert, Button } from '../ui/controls';

const LEVEL = {
  ok: { tone: 'success', text: 'Data is stored on the server and kept across restarts.' },
  warning: { tone: 'warn', text: 'Data may not survive a redeploy. See below.' },
  error: { tone: 'error', text: 'Data storage is not safe. See below.' },
} as const;

/** Where data lives on the server, whether it is persistent, and its backups (admins only). */
export function DataStorageCard() {
  const state = useApi<StorageStatus>('/system/storage');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const s = state.data;

  async function backupNow() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ backup: { name: string } }>('/system/backups', { method: 'POST' });
      setMessage({ tone: 'success', text: `Backup ${r.backup.name} made.` });
      state.reload();
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'error') return <Card><Alert>{state.error}</Alert></Card>;
  if (!s) return <Card><p className="text-[14px] text-muted">Loading…</p></Card>;
  const level = LEVEL[s.persistence];

  return (
    <Card>
      <Alert tone={level.tone}>{level.text}</Alert>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[180px_1fr]">
        <dt className="text-muted">Data folder</dt>
        <dd className="break-all">
          <code>{s.dataDir}</code> {s.configuredPath ? '(set with DATA_DIR)' : '(default; set DATA_DIR to choose)'}
        </dd>
        <dt className="text-muted">Writable</dt>
        <dd>{s.writable ? 'Yes' : <span className="font-semibold text-bad">No</span>}</dd>
        <dt className="text-muted">In use since</dt>
        <dd>{s.createdAt ? formatIst(s.createdAt) : '–'}</dd>
        <dt className="text-muted">Last backup</dt>
        <dd>{s.lastBackupAt ? formatIst(s.lastBackupAt) : 'None yet'}</dd>
      </dl>
      {s.messages.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] text-ink">
          {s.messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {s.recentProblems.length > 0 && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer font-semibold text-avg">Recent storage notices ({s.recentProblems.length})</summary>
          <ul className="mt-1 space-y-1 text-muted">
            {s.recentProblems.map((p, i) => (
              <li key={i}>
                {formatIst(p.at)} — {p.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <h4 className="font-semibold text-navy">Backups ({s.backups.length})</h4>
        <Button variant="secondary" onClick={() => void backupNow()} disabled={busy}>
          {busy ? 'Backing up…' : 'Back up now'}
        </Button>
      </div>
      {message && (
        <div className="mt-2">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
      {s.backups.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-head text-left text-navy">
                {['Backup', 'Made', 'Why', 'Files', 'Size'].map((h) => (
                  <th key={h} className="px-2.5 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.backups.map((b) => (
                <tr key={b.name} className="border-b border-line">
                  <td className="px-2.5 py-1.5">
                    <code className="text-[13px]">{b.name}</code>
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{formatIst(b.createdAt)}</td>
                  <td className="px-2.5 py-1.5">{b.reason}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{b.files}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{formatBytes(b.totalBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[13px] text-muted">
        A backup is made automatically every day, and the newest ones are kept. To restore one, stop the server and run{' '}
        <code>npm run data -- restore &lt;backup name&gt;</code> on the server; a safety backup of the current data is made first.
        Backups live inside the data folder, so also copy that folder off the server from time to time.
      </p>
    </Card>
  );
}
