import { META_OPTIONAL_PERMISSIONS, META_READ_PERMISSIONS } from '@sop/shared';
import { MetaApiError } from './graphClient.js';

/**
 * Which Meta permissions the tracker uses, and plain-language explanations of Meta errors.
 *
 * Reading campaigns, ad sets, ads, creatives and insights needs only ads_read (ads_management also
 * includes read access). Every other permission is optional: a token that has more is accepted.
 */

/** Either one is enough to read ad data; the rest add something but are never required. */
export const READ_PERMISSIONS = META_READ_PERMISSIONS;
export const OPTIONAL_PERMISSIONS = META_OPTIONAL_PERMISSIONS;

export const hasReadPermission = (scopes: string[]) => READ_PERMISSIONS.some((p) => scopes.includes(p));

/** "(#100) Requires business_management permission to access the field." → "business_management" */
export function missingPermissionIn(message: string): string | null {
  return /requires (?:the )?['"]?([a-z_]+)['"]? permission/i.exec(message)?.[1] ?? null;
}

/** Meta's "object does not exist or cannot be loaded due to missing permissions". */
export const isNoAccessToObject = (err: unknown) => err instanceof MetaApiError && err.code === 100 && err.subcode === 33;

/** A field or edge the token may not read (missing permission or a field this object does not support). */
export function isFieldPermissionError(err: unknown): boolean {
  if (!(err instanceof MetaApiError) || err.isTokenInvalid || err.isTransient) return false;
  return err.code === 100 || err.code === 10 || (err.code !== undefined && err.code >= 200 && err.code < 300);
}

const TOKEN_SUBCODE: Record<number, string> = {
  458: 'the app was removed from the account',
  459: 'the account needs to log in to Facebook to fix a checkpoint',
  460: 'the password was changed',
  463: 'it has expired',
  464: 'the Facebook account is not confirmed',
  467: 'it is no longer valid',
  492: 'the user is no longer an admin or system user of the Business',
};

/** One readable sentence for an error from Meta, with what to do about it. */
export function explainMetaError(err: unknown, ctx: { accountId?: string } = {}): string {
  if (!(err instanceof MetaApiError)) return err instanceof Error ? err.message : String(err);
  const m = err.message.replace(/\s+/g, ' ').trim();
  const where = ctx.accountId ? ` ad account ${ctx.accountId}` : '';
  const ref = err.code ? ` (Meta error ${err.code}${err.subcode ? `/${err.subcode}` : ''})` : '';

  if (err.isTokenInvalid) {
    const why = err.subcode ? TOKEN_SUBCODE[err.subcode] : undefined;
    return `The Meta access token can no longer be used${why ? ` because ${why}` : ''}. Generate a new token and connect again in Settings. Meta said: ${m}${ref}`;
  }
  if (/appsecret_proof/i.test(m)) {
    return /require/i.test(m)
      ? `The token's Meta app requires an app secret proof. Enter that app's App ID and App Secret under Meta app, or use a token from the configured app.${ref}`
      : `The token was issued for a different Meta app than the one configured, so its app secret proof does not match.${ref}`;
  }
  if (isNoAccessToObject(err)) {
    return `This token cannot see${where || ' this object'}: it does not exist, or it is not assigned to the token's person or system user. In Meta Business Settings → Accounts → Ad accounts, assign the ad account to them (view-only access is enough).${ref}`;
  }
  const perm = missingPermissionIn(m);
  if (perm) {
    const optional = OPTIONAL_PERMISSIONS[perm];
    return optional
      ? `The token does not have the optional ${perm} permission (${optional.replace(/\.$/, '').toLowerCase()}). Campaign data does not need it.${ref}`
      : `The token is missing the ${perm} permission needed to read${where || ' this data'}. Add ${perm} to the token (or the system user's assigned permissions) and connect again.${ref}`;
  }
  if (err.code === 200 || err.code === 10 || (err.code !== undefined && err.code > 200 && err.code < 300)) {
    return `Meta refused access to${where || ' this data'}: ${m}. Check that the token has ads_read and that its person or system user is assigned to the ad account in Business Settings.${ref}`;
  }
  if (err.isRateLimit) return `Meta's rate limit was reached; try again in a while. Meta said: ${m}${ref}`;
  if (err.code === 368) return `Meta has temporarily blocked this account from this action: ${m}${ref}`;
  if (err.status >= 500 || err.code === 1 || err.code === 2) return `Meta had a temporary problem; try again. Meta said: ${m}${ref}`;
  return `${m}${ref}`;
}
