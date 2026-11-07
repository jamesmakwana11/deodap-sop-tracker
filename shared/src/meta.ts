/** Either one is enough to read campaigns, ad sets, ads, creatives and insights. */
export const META_READ_PERMISSIONS = ['ads_read', 'ads_management'] as const;

/** Permissions that add something but are never required. */
export const META_OPTIONAL_PERMISSIONS: Record<string, string> = {
  business_management: 'Shows the Business portfolio name of each ad account.',
};

/** What Meta reported about a token when it was last checked. */
export interface TokenCheckInfo {
  checkedAt: string;
  /** debug_token = via the configured app; self_debug = the token inspected itself; permissions = me/permissions only. */
  method: 'debug_token' | 'self_debug' | 'permissions' | 'none';
  type: 'USER' | 'SYSTEM_USER' | 'PAGE' | 'APP' | 'UNKNOWN';
  appId: string | null;
  appName: string | null;
  /** null when no Meta app is configured or the app could not be read. */
  sameAppAsConfigured: boolean | null;
  /** null = does not expire (or not reported). */
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  granted: string[];
  declined: string[];
  /** Ad account IDs ads_read was granted for, when Meta limits it to specific accounts. */
  granularAdAccounts: string[] | null;
  canReadAds: boolean;
  warnings: string[];
}

export interface MetaConnectionInfo {
  id: string;
  metaUserId: string;
  metaUserName: string | null;
  tokenType: 'user' | 'system_user';
  scopes: string[];
  expiresAt: string | null;
  status: 'active' | 'invalid';
  lastError: string | null;
  createdAt: string;
  /** null for connections saved before token checks existed (until "Check again"). */
  check: TokenCheckInfo | null;
}

/** Result of reading an ad account with the connection's token. */
export interface AccountAccessInfo {
  checkedAt: string;
  campaigns: 'ok' | 'denied' | 'error';
  insights: 'ok' | 'denied' | 'error';
  /** Why something is not readable, in plain language. */
  message: string | null;
}

/** What a connect or "check again" found. */
export interface MetaDiscoveryReport {
  /** Accounts listed automatically by Meta (me/adaccounts). */
  discovered: number;
  /** Error from automatic discovery, if it failed (manual IDs may still work). */
  discoveryError: string | null;
  manual: Array<{ metaAccountId: string; ok: boolean; name: string | null; message: string | null }>;
  /** Accounts whose campaigns and insights were test-read. */
  checked: number;
  readable: number;
  businessNames: 'shown' | 'not_permitted' | 'unavailable';
  warnings: string[];
}

export interface AdAccountInfo {
  id: string;
  metaAccountId: string;
  name: string;
  currency: string;
  timezone: string | null;
  businessName: string | null;
  accountStatus: number | null;
  /** Selected for auditing. */
  selected: boolean;
  connectionId: string | null;
  isDevData: boolean;
  /** Entered by ID instead of found automatically. */
  addedManually: boolean;
  access: AccountAccessInfo | null;
}

export interface SyncScheduleInfo {
  /** HH:MM in IST, or null when the daily sync is off. */
  timeIst: string | null;
  nextRunAt: string | null;
}

/** Meta app settings as an admin may see them: never the App Secret itself. */
export interface MetaAppPublicConfig {
  appId: string | null;
  hasAppSecret: boolean;
  /** The redirect URI used for sign-in from the address this page was opened on. */
  redirectUri: string;
  /** "detected" = worked out from the current address (normal); otherwise a fixed URI from Settings or META_REDIRECT_URI. */
  redirectUriSource: 'detected' | 'settings' | 'environment';
  /** What the current address gives, whether or not a fixed URI is set. */
  detectedRedirectUri: string;
  /** Fixed URI saved in Settings (null = detect automatically). */
  fixedRedirectUri: string | null;
  /** A saved localhost URI that is being ignored because the app is open on a public domain. */
  ignoredFixedRedirectUri: string | null;
  graphVersion: string;
  source: 'settings' | 'environment' | 'none';
}

export interface MetaStatusResponse {
  /** Server has META_APP_ID, META_APP_SECRET, META_REDIRECT_URI and TOKEN_ENCRYPTION_KEY. */
  oauthConfigured: boolean;
  /** Server can store a pasted system-user token (needs TOKEN_ENCRYPTION_KEY). */
  tokenStorageConfigured: boolean;
  graphVersion: string;
  connections: MetaConnectionInfo[];
  accounts: AdAccountInfo[];
  schedule: SyncScheduleInfo;
  app: MetaAppPublicConfig;
  /** Where the token encryption key comes from. */
  encryptionKey: 'environment' | 'key-file' | 'none';
}

/** Meta ad account_status codes. */
export const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: 'Active',
  2: 'Disabled',
  3: 'Unsettled',
  7: 'Pending risk review',
  8: 'Pending settlement',
  9: 'In grace period',
  100: 'Pending closure',
  101: 'Closed',
  201: 'Any active',
  202: 'Any closed',
};

export interface BackupInfo {
  name: string;
  createdAt: string;
  reason: string;
  files: number;
  totalBytes: number;
}

export interface StorageStatus {
  dataDir: string;
  /** DATA_DIR was set explicitly. */
  configuredPath: boolean;
  writable: boolean;
  /** ok: persistent as far as the server can tell; warning: may be lost on redeploy; error: not usable. */
  persistence: 'ok' | 'warning' | 'error';
  messages: string[];
  createdAt: string | null;
  backups: BackupInfo[];
  lastBackupAt: string | null;
  recentProblems: { at: string; message: string }[];
}
