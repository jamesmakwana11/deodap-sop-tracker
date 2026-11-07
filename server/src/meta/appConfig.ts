import type { MetaAppPublicConfig } from '@sop/shared';
import { env } from '../config/env.js';
import { isLoopbackHost } from '../http/publicUrl.js';
import { decryptSecret, encryptSecret } from '../security/tokenCrypto.js';
import { store } from '../storage/store.js';

/**
 * The Meta app the tracker connects through. Saved on the server by an admin (Settings),
 * with the App Secret encrypted; META_* environment variables are the fallback.
 */

export const META_APP_SETTING = 'meta_app';

interface StoredMetaApp {
  appId: string;
  appSecretCiphertext: string | null;
  redirectUri: string | null;
  graphVersion: string | null;
}

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  /** Optional fixed redirect URI (Settings or META_REDIRECT_URI). Usually null: it is detected per request. */
  fixedRedirectUri: string | null;
  graphVersion: string;
  source: 'settings' | 'environment';
}

const stored = () => (store.c.settings.get(META_APP_SETTING)?.value as StoredMetaApp | undefined) ?? null;

const hostOf = (uri: string) => {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
};

/**
 * The redirect URI to use for a request: a fixed one when an admin set it (Settings, then
 * META_REDIRECT_URI), otherwise the one detected from the request's own address.
 * A fixed localhost URI is never used when the app is reached on a public domain — older
 * versions pre-filled the Settings form with a localhost default, which would break production.
 */
export function resolveRedirectUri(cfg: Pick<MetaAppConfig, 'fixedRedirectUri'>, detected: string): { uri: string; source: 'detected' | 'fixed'; ignoredFixed: string | null } {
  const fixed = cfg.fixedRedirectUri;
  if (!fixed) return { uri: detected, source: 'detected', ignoredFixed: null };
  if (isLoopbackHost(hostOf(fixed)) && !isLoopbackHost(hostOf(detected))) return { uri: detected, source: 'detected', ignoredFixed: fixed };
  return { uri: fixed, source: 'fixed', ignoredFixed: null };
}

export function graphVersion(): string {
  return stored()?.graphVersion || env.META_GRAPH_VERSION;
}

/** App secret for appsecret_proof, when one is configured. */
export function metaAppSecret(): string | undefined {
  const s = stored();
  if (s?.appSecretCiphertext) {
    try {
      return decryptSecret(s.appSecretCiphertext);
    } catch {
      return undefined;
    }
  }
  return env.META_APP_SECRET;
}

export function metaAppConfig(): MetaAppConfig | null {
  const s = stored();
  if (s?.appId) {
    const secret = metaAppSecret();
    if (!secret) return null;
    return { appId: s.appId, appSecret: secret, fixedRedirectUri: s.redirectUri || null, graphVersion: graphVersion(), source: 'settings' };
  }
  if (env.META_APP_ID && env.META_APP_SECRET) {
    return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, fixedRedirectUri: env.META_REDIRECT_URI ?? null, graphVersion: graphVersion(), source: 'environment' };
  }
  return null;
}

/** Settings as an admin may see them (never the secret), with the redirect URI for this request. */
export function metaAppPublicConfig(detected: string): MetaAppPublicConfig {
  const s = stored();
  const fromSettings = Boolean(s?.appId);
  const fixedRedirectUri = fromSettings ? s!.redirectUri || null : (env.META_REDIRECT_URI ?? null);
  const r = resolveRedirectUri({ fixedRedirectUri }, detected);
  return {
    appId: fromSettings ? s!.appId : (env.META_APP_ID ?? null),
    hasAppSecret: fromSettings ? Boolean(s!.appSecretCiphertext) : Boolean(env.META_APP_SECRET),
    redirectUri: r.uri,
    redirectUriSource: r.source === 'detected' ? 'detected' : fromSettings ? 'settings' : 'environment',
    detectedRedirectUri: detected,
    fixedRedirectUri: fromSettings ? s!.redirectUri || null : null,
    ignoredFixedRedirectUri: r.ignoredFixed,
    graphVersion: graphVersion(),
    source: fromSettings ? 'settings' : env.META_APP_ID ? 'environment' : 'none',
  };
}

/** Saves the app settings. An empty appSecret keeps the saved one. */
export async function saveMetaAppConfig(
  input: { appId: string; appSecret?: string | null; redirectUri?: string | null; graphVersion?: string | null },
  userId: string,
  detected: string,
): Promise<MetaAppPublicConfig> {
  const prev = stored();
  const value: StoredMetaApp = {
    appId: input.appId,
    appSecretCiphertext: input.appSecret ? encryptSecret(input.appSecret) : (prev?.appId === input.appId ? prev.appSecretCiphertext : null),
    redirectUri: input.redirectUri || null,
    graphVersion: input.graphVersion || null,
  };
  await store.c.settings.put({ id: META_APP_SETTING, value, updatedAt: new Date().toISOString(), updatedBy: userId });
  return metaAppPublicConfig(detected);
}
