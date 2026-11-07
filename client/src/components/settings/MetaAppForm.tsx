import type { MetaAppPublicConfig } from '@sop/shared';
import { useState, type FormEvent } from 'react';
import { CopyField } from '../ui/CopyField';
import { api } from '../../api/http';
import { Alert, Button, Field, Input } from '../ui/controls';

/**
 * Meta app details for Facebook login, saved on the server. The App Secret is write-only:
 * it is encrypted on the server and never sent back to the browser.
 */
export function MetaAppForm({ app, onSaved }: { app: MetaAppPublicConfig; onSaved: (text: string) => void }) {
  const [appId, setAppId] = useState(app.appId ?? '');
  const [appSecret, setAppSecret] = useState('');
  // Only a deliberately saved fixed URI is shown here; empty means "detect automatically".
  const [redirectUri, setRedirectUri] = useState(app.fixedRedirectUri ?? '');
  const [showFixed, setShowFixed] = useState(Boolean(app.fixedRedirectUri));
  const [graphVersion, setGraphVersion] = useState(app.graphVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/meta/app', {
        method: 'PUT',
        body: { appId: appId.trim(), appSecret: appSecret.trim() || null, redirectUri: redirectUri.trim() || null, graphVersion: graphVersion.trim() || null },
      });
      setAppSecret('');
      onSaved('Meta app details saved. The App Secret is stored encrypted on the server.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <p className="text-[13px] text-muted">
        {app.source === 'settings'
          ? 'Saved on the server.'
          : app.source === 'environment'
            ? 'Currently read from the server’s environment (META_APP_ID, META_APP_SECRET). Saving here overrides it.'
            : 'Not set yet. Needed for “Connect Meta” (Facebook login). A system-user token works without it.'}
      </p>

      <div className="mt-3 rounded-xl border border-line bg-head/40 p-3.5">
        <div className="text-[13px] font-semibold text-navy">
          Redirect URI {app.redirectUriSource === 'detected' ? '(detected from this address)' : `(fixed, from ${app.redirectUriSource === 'settings' ? 'Settings' : 'META_REDIRECT_URI'})`}
        </div>
        <CopyField value={app.redirectUri} label="Redirect URI" />
        <p className="mt-2 text-[13px] leading-snug text-muted">
          Add this exact address once in the Meta app: <b>Meta for Developers → your app → Facebook Login → Settings → Valid OAuth
          Redirect URIs</b>. Each domain the tracker is opened on (localhost, the Render address, a custom domain) gives its own address,
          and each one must be added there once.
        </p>
        {app.redirectUriSource !== 'detected' && app.detectedRedirectUri !== app.redirectUri && (
          <p className="mt-2 text-[13px] text-avg">This page is open on another address ({app.detectedRedirectUri}). Sign-in will return to the fixed URI above.</p>
        )}
        {app.ignoredFixedRedirectUri && (
          <p className="mt-2 text-[13px] text-avg">
            A saved localhost redirect URI ({app.ignoredFixedRedirectUri}) is ignored on this domain. Clear it below and save to remove it.
          </p>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="App ID">
          <Input value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" autoComplete="off" required />
        </Field>
        <Field label="App Secret" hint={app.hasAppSecret ? 'Saved. Leave blank to keep it.' : 'App settings → Basic in the Meta app dashboard.'}>
          <Input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            autoComplete="new-password"
            placeholder={app.hasAppSecret ? '••••••••••••••••' : '32-character code'}
          />
        </Field>
        {showFixed ? (
          <Field label="Fixed redirect URI (optional)" hint="Leave empty to detect it automatically (recommended).">
            <Input type="url" value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder={app.detectedRedirectUri} />
          </Field>
        ) : (
          <div className="flex items-end">
            <button type="button" className="h-9 text-[13px] font-semibold text-brand hover:underline" onClick={() => setShowFixed(true)}>
              Use a fixed redirect URI instead…
            </button>
          </div>
        )}
        <Field label="Graph API version">
          <Input value={graphVersion} onChange={(e) => setGraphVersion(e.target.value)} placeholder="v26.0" />
        </Field>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <Button type="submit" className="mt-3" disabled={busy || !appId.trim()}>
        {busy ? 'Saving…' : 'Save app details'}
      </Button>
    </form>
  );
}
