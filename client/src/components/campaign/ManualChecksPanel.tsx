import { ATTACHMENT_EXTENSIONS, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, type AttachmentInfo, type ManualCheckState, type ManualEvent, type ManualStatus } from '@sop/shared';
import { useRef, useState, type ReactNode } from 'react';
import { api, downloadFile, uploadFile } from '../../api/http';
import { formatBytes, formatIst } from '../../lib/format';
import { reportsAvailable } from '../../lib/reports';
import { Alert, Button, Input, Select } from '../ui/controls';

const STATUS_TEXT: Record<ManualStatus, string> = {
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  FAILED: 'Failed',
  NOT_APPLICABLE: 'Not applicable',
};
const STATUS_CLASS: Record<ManualStatus, string> = {
  PENDING: 'text-neutral',
  VERIFIED: 'text-good',
  FAILED: 'text-bad',
  NOT_APPLICABLE: 'text-slate-500',
};

const ACCEPT = [...Object.keys(ATTACHMENT_TYPES), ...Object.keys(ATTACHMENT_EXTENSIONS).map((e) => `.${e}`)].join(',');

/** Evidence files for one manual check: kept on the server, always downloaded (never opened in the app). */
function Evidence({
  metaCampaignId,
  item,
  editable,
  onChecks,
}: {
  metaCampaignId: string;
  item: ManualCheckState;
  editable: boolean;
  onChecks: (checks: ManualCheckState[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) return setError(`Files can be up to ${MAX_ATTACHMENT_BYTES / 1_048_576} MB.`);
    setBusy(true);
    try {
      const r = await uploadFile<{ manualChecks: ManualCheckState[] }>(`/manual-checks/${encodeURIComponent(metaCampaignId)}/${item.key}/attachments`, file);
      onChecks(r.manualChecks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(f: AttachmentInfo) {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ manualChecks: ManualCheckState[] }>(`/attachments/${f.id}`, { method: 'DELETE' });
      onChecks(r.manualChecks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  if (!item.attachments.length && !editable) return null;
  return (
    <div className="mt-2 text-[13px]">
      {item.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {item.attachments.map((f) => (
            <li key={f.id} className="flex items-center gap-1.5 rounded-lg bg-head/60 px-2 py-1 ring-1 ring-line">
              <button
                type="button"
                className="font-semibold text-brand hover:underline disabled:text-muted"
                disabled={!reportsAvailable}
                title={`Uploaded by ${f.uploadedBy ?? 'unknown'}, ${formatIst(f.uploadedAt)}`}
                onClick={() => downloadFile(`/attachments/${f.id}`, f.fileName).catch((e: Error) => setError(e.message))}
              >
                {f.fileName}
              </button>
              <span className="text-muted">{formatBytes(f.size)}</span>
              {editable &&
                (confirming === f.id ? (
                  <>
                    <button type="button" className="font-semibold text-bad hover:underline" disabled={busy} onClick={() => void remove(f)}>
                      Delete
                    </button>
                    <button type="button" className="text-muted hover:underline" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" aria-label={`Remove ${f.fileName}`} className="px-1 text-muted hover:text-bad" onClick={() => setConfirming(f.id)}>
                    ×
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className={item.attachments.length ? 'mt-1.5' : ''}>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label={`Evidence file for ${item.label}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button
            type="button"
            className="font-semibold text-brand hover:underline disabled:text-muted"
            disabled={busy || !reportsAvailable}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Uploading…' : '+ Add evidence'}
          </button>
          <span className="ml-2 text-muted">Screenshot, PDF, Excel, Word, CSV or text, up to {MAX_ATTACHMENT_BYTES / 1_048_576} MB</span>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-bad">{error}</p>}
    </div>
  );
}

function Row({
  item,
  editable,
  onSave,
  evidence,
}: {
  item: ManualCheckState;
  editable: boolean;
  onSave: (s: ManualStatus, note: string) => Promise<void>;
  evidence: ReactNode;
}) {
  const [status, setStatus] = useState<ManualStatus>(item.status);
  const [note, setNote] = useState(item.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = status !== item.status || note !== (item.note ?? '');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(status, note);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[220px] flex-1">
          <div className="font-semibold text-ink">{item.label}</div>
          <div className="text-[13px] text-muted">{item.help}</div>
          {item.updatedBy && (
            <div className="mt-0.5 text-[12px] text-muted">
              {STATUS_TEXT[item.status]} by {item.updatedBy}, {formatIst(item.updatedAt!)}
              {item.note ? ` — “${item.note}”` : ''}
            </div>
          )}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ManualStatus)} aria-label={`${item.label} status`}>
              {(Object.keys(STATUS_TEXT) as ManualStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_TEXT[s]}
                </option>
              ))}
            </Select>
            <Input
              placeholder={status === 'FAILED' ? 'What is wrong? (required)' : 'Note (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-56"
              aria-label={`${item.label} note`}
            />
            <Button onClick={() => void save()} disabled={!dirty || busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ) : (
          <span className={`font-semibold ${STATUS_CLASS[item.status]}`}>{STATUS_TEXT[item.status]}</span>
        )}
      </div>
      {evidence}
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
    </li>
  );
}

export function ManualChecksPanel({
  metaCampaignId,
  checks,
  events,
  editable,
  onChange,
}: {
  metaCampaignId: string;
  checks: ManualCheckState[];
  events: ManualEvent[];
  editable: boolean;
  onChange: (checks: ManualCheckState[], events: ManualEvent[]) => void;
}) {
  const label = new Map(checks.map((c) => [c.key, c.label]));
  async function save(key: string, status: ManualStatus, note: string) {
    const r = await api<{ manualChecks: ManualCheckState[]; manualEvents: ManualEvent[] }>(
      `/manual-checks/${encodeURIComponent(metaCampaignId)}/${key}`,
      { method: 'PUT', body: { status, note: note || null } },
    );
    onChange(r.manualChecks, r.manualEvents);
  }

  return (
    <div>
      <p className="mb-2 text-[13px] text-muted">
        These SOP items cannot be read from Meta. Each stays Pending until a person checks it — nothing is marked as
        verified automatically. {editable ? '' : 'Auditors and admins can update them.'}
      </p>
      <ul>
        {checks.map((c) => (
          <Row
            key={`${c.key}-${c.updatedAt}`}
            item={c}
            editable={editable}
            onSave={(s, n) => save(c.key, s, n)}
            evidence={<Evidence metaCampaignId={metaCampaignId} item={c} editable={editable} onChecks={(next) => onChange(next, events)} />}
          />
        ))}
      </ul>
      {events.length > 0 && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer font-semibold text-navy">Change log ({events.length})</summary>
          <ul className="mt-2 space-y-1 text-muted">
            {events.map((e, i) => (
              <li key={i}>
                {formatIst(e.at)} · {e.user ?? 'Unknown'} set {label.get(e.key) ?? e.key} to {STATUS_TEXT[e.status]}
                {e.note ? ` — “${e.note}”` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
