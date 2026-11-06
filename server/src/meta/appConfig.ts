import type { MetaAppPublicConfig } from '@sop/shared';
import { env } from '../config/env.js';
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
  redirectUri: string;
  graphVersion: string;
  source: 'settings' | 'environment';
}

const stored = () => (store.c.settings.get(META_APP_SETTING)?.value as StoredMetaApp | undefined) ?? null;
export const defaultRedirectUri = () => `${env.CLIENT_ORIGIN.replace(/\/$/, '')}/api/meta/oauth/callback`;

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
    return { appId: s.appId, appSecret: secret, redirectUri: s.redirectUri || defaultRedirectUri(), graphVersion: graphVersion(), source: 'settings' };
  }
  if (env.META_APP_ID && env.META_APP_SECRET && env.META_REDIRECT_URI) {
    return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, redirectUri: env.META_REDIRECT_URI, graphVersion: graphVersion(), source: 'environment' };
  }
  return null;
}

export function metaAppPublicConfig(): MetaAppPublicConfig {
  const s = stored();
  if (s?.appId) {
    return { appId: s.appId, hasAppSecret: Boolean(s.appSecretCiphertext), redirectUri: s.redirectUri || defaultRedirectUri(), defaultRedirectUri: defaultRedirectUri(), graphVersion: graphVersion(), source: 'settings' };
  }
  return {
    appId: env.META_APP_ID ?? null,
    hasAppSecret: Boolean(env.META_APP_SECRET),
    redirectUri: env.META_REDIRECT_URI ?? null,
    defaultRedirectUri: defaultRedirectUri(),
    graphVersion: graphVersion(),
    source: env.META_APP_ID ? 'environment' : 'none',
  };
}

/** Saves the app settings. An empty appSecret keeps the saved one. */
export async function saveMetaAppConfig(
  input: { appId: string; appSecret?: string | null; redirectUri?: string | null; graphVersion?: string | null },
  userId: string,
): Promise<MetaAppPublicConfig> {
  const prev = stored();
  const value: StoredMetaApp = {
    appId: input.appId,
    appSecretCiphertext: input.appSecret ? encryptSecret(input.appSecret) : (prev?.appId === input.appId ? prev.appSecretCiphertext : null),
    redirectUri: input.redirectUri || null,
    graphVersion: input.graphVersion || null,
  };
  await store.c.settings.put({ id: META_APP_SETTING, value, updatedAt: new Date().toISOString(), updatedBy: userId });
  return metaAppPublicConfig();
}
