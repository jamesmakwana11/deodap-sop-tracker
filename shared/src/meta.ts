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
  redirectUri: string | null;
  defaultRedirectUri: string;
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
