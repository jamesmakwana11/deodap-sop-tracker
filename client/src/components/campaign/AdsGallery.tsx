import type { AdDetail } from '@sop/shared';
import { useEffect, useState } from 'react';
import { api } from '../../api/http';
import { Alert, Button, Select } from '../ui/controls';

const FORMATS = {
  MOBILE_FEED_STANDARD: 'Facebook feed (mobile)',
  DESKTOP_FEED_STANDARD: 'Facebook feed (desktop)',
  INSTAGRAM_STANDARD: 'Instagram feed',
  INSTAGRAM_STORY: 'Instagram story',
} as const;
type Format = keyof typeof FORMATS;

function PreviewDialog({ ad, onClose }: { ad: AdDetail; onClose: () => void }) {
  const [format, setFormat] = useState<Format>('MOBILE_FEED_STANDARD');
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    setError(null);
    api<{ src: string }>(`/ads/${ad.id}/preview?format=${format}`)
      .then((r) => setSrc(r.src))
      .catch((e: Error) => setError(e.message));
  }, [ad.id, format]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${ad.name}`}
        className="flex max-h-[92vh] w-full max-w-[600px] flex-col rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-navy">{ad.name}</h3>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <Select value={format} onChange={(e) => setFormat(e.target.value as Format)} className="mt-3">
          {(Object.keys(FORMATS) as Format[]).map((f) => (
            <option key={f} value={f}>
              {FORMATS[f]}
            </option>
          ))}
        </Select>
        <div className="mt-3 min-h-[300px] flex-1 overflow-auto">
          {error && <Alert>{error}</Alert>}
          {!error && !src && <p className="py-10 text-center text-muted">Asking Meta for the preview…</p>}
          {src && (
            <iframe
              title="Meta ad preview"
              src={src}
              className="mx-auto h-[640px] w-full max-w-[540px] rounded-lg border border-line"
              sandbox="allow-scripts allow-same-origin allow-popups"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
        <p className="mt-2 text-[12px] text-muted">Live preview from Meta, as the ad stands now.</p>
      </div>
    </div>
  );
}

function Thumb({ ad }: { ad: AdDetail }) {
  const [broken, setBroken] = useState(false);
  const url = ad.thumbnailUrl ?? ad.imageUrl;
  if (!url || broken) {
    return <div className="flex h-28 items-center justify-center rounded-lg bg-head/60 text-[12px] text-muted">No image saved</div>;
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="h-28 w-full rounded-lg bg-head/40 object-contain"
    />
  );
}

export function AdsGallery({ ads, canPreview }: { ads: AdDetail[]; canPreview: boolean }) {
  const [open, setOpen] = useState<AdDetail | null>(null);
  if (ads.length === 0) return <p className="text-[14px] text-muted">No active ads were returned for this campaign.</p>;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {ads.map((ad) => (
          <div key={ad.id} className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
            <Thumb ad={ad} />
            <div className="text-[14px] font-semibold text-ink">{ad.name}</div>
            <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[13px]">
              <dt className="text-muted">Primary text</dt>
              <dd className={ad.primaryText ? 'line-clamp-3 text-ink' : 'font-semibold text-bad'}>{ad.primaryText ?? 'Missing'}</dd>
              <dt className="text-muted">Headline</dt>
              <dd className="text-ink">{ad.headline ?? '–'}</dd>
              <dt className="text-muted">Button</dt>
              <dd className={ad.ctaType ? 'text-ink' : 'font-semibold text-bad'}>{ad.ctaType?.replace(/_/g, ' ').toLowerCase() ?? 'Missing'}</dd>
              <dt className="text-muted">Ad ID</dt>
              <dd className="tabular-nums text-muted">{ad.metaAdId}</dd>
            </dl>
            <div className="mt-auto flex gap-2">
              {canPreview && (
                <Button variant="secondary" onClick={() => setOpen(ad)}>
                  Preview
                </Button>
              )}
              {ad.permalinkUrl && (
                <a href={ad.permalinkUrl} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 items-center px-2 text-[14px] font-semibold text-brand">
                  Instagram post ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      {open && <PreviewDialog ad={open} onClose={() => setOpen(null)} />}
    </>
  );
}
