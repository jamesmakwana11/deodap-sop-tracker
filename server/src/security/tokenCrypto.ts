import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from '../config/env.js';
import { HttpError } from '../http/errors.js';
import { store } from '../storage/store.js';

/** AES-256-GCM for Meta tokens at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */

/** TOKEN_ENCRYPTION_KEY, or the key generated into the data folder when it is not set. */
export function encryptionKeySource(): 'environment' | 'key-file' | 'none' {
  if (env.TOKEN_ENCRYPTION_KEY) return 'environment';
  try {
    readFileSync(store.keyFilePath());
    return 'key-file';
  } catch {
    return 'none';
  }
}

function defaultKey(): string | undefined {
  if (env.TOKEN_ENCRYPTION_KEY) return env.TOKEN_ENCRYPTION_KEY;
  try {
    return readFileSync(store.keyFilePath(), 'utf8').trim();
  } catch {
    return undefined;
  }
}

function loadKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new HttpError(500, 'No token encryption key: set TOKEN_ENCRYPTION_KEY or let the server create one in its data folder.', 'config');
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new HttpError(500, 'TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters).', 'config');
  }
  return key;
}

export function encryptSecret(plain: string, rawKey = defaultKey()): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ct].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function decryptSecret(payload: string, rawKey = defaultKey()): string {
  const key = loadKey(rawKey);
  const [version, iv, tag, ct] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised encrypted token format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
