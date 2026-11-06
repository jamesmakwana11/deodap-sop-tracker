import type { MetaAppPublicConfig } from '@sop/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/http';
import { Alert, Button, Field, Input } from '../ui/controls';

/**
 * Meta app details for Facebook login, saved on the server. The App Secret is write-only:
 * it is encrypted on the server and never sent back to the browser.
 */
export function MetaAppForm({ app, onSaved }: { app: MetaAppPublicConfig; onSaved: (text: string) => void }) {
  const [appId, setAppId] = useState(app.appId ?? '');
  const [appSecret, setAppSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(app.redirectUri ?? '');
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
            : 'Not set yet. Needed for “Connect Meta” (Facebook login). A system-user token works without it.'}{' '}
        In the Meta app, add the redirect URI below under Facebook Login → Valid OAuth Redirect URIs.
      </p>
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
        <Field label="Redirect URI" hint={`Default: ${app.defaultRedirectUri}`}>
          <Input type="url" value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder={app.defaultRedirectUri} />
        </Field>
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
