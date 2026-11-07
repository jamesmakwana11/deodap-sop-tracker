import type {
  AccountAccessInfo,
  TokenCheckInfo,
  CheckResult,
  ManualStatus,
  MetricKind,
  ObjectiveLabel,
  Rating,
  Role,
  RunSource,
  RunStatus,
  RunTotals,
  DeliveryState,
  MetaCampaignStatusCounts,
} from '@sop/shared';

/**
 * Stored record shapes. They mirror the earlier SQL tables (see db-schema-postgres/) so a
 * PostgreSQL backend can map onto them later. Dates are ISO strings.
 */

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

/** id = SHA-256 of the session token; the raw token is only in the cookie. */
export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
}

export interface MetaConnectionRecord {
  id: string;
  metaUserId: string;
  metaUserName: string | null;
  tokenType: 'user' | 'system_user';
  /** AES-256-GCM; never returned by the API. */
  tokenCiphertext: string;
  scopes: string[];
  expiresAt: string | null;
  status: 'active' | 'invalid';
  lastError: string | null;
  connectedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Added later; absent on older records. Absent useAppSecretProof means "use it" (the old behaviour). */
  useAppSecretProof?: boolean;
  check?: TokenCheckInfo | null;
}

/** id = SHA-256 of the OAuth state. */
export interface OAuthStateRecord {
  id: string;
  userId: string;
  expiresAt: string;
  /** The redirect URI sent to Meta's login dialog; reused for the code exchange. */
  redirectUri?: string;
}

export interface AdAccountRecord {
  id: string;
  metaAccountId: string;
  name: string;
  currency: string;
  timezone: string | null;
  /** Selected for auditing. */
  isActive: boolean;
  isDevData: boolean;
  connectionId: string | null;
  accountStatus: number | null;
  businessName: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Added later; absent on older records. */
  addedManually?: boolean;
  access?: AccountAccessInfo | null;
}

/** id = setting key. */
export interface SettingRecord {
  id: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string | null;
}

export interface RunAccountResult {
  adAccountId: string;
  status: 'succeeded' | 'failed';
  error: string | null;
  /** What could not be read although the account succeeded (absent on older runs). */
  notes?: string[];
  /** Campaigns per Meta status, all statuses, unique IDs (absent on older runs). */
  campaignCounts?: MetaCampaignStatusCounts;
}

export interface AuditRunRecord {
  id: string;
  source: RunSource;
  trigger: 'scheduled' | 'manual' | 'seed';
  status: RunStatus;
  periodStart: string | null;
  periodEnd: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  triggeredBy: string | null;
  accounts: RunAccountResult[];
  /** Calculated when the run finishes (ratings and checks never change afterwards). */
  totals: RunTotals | null;
  /** Version of the SOP rule set the run was audited with (see settings "sop_rules:<version>"). */
  rulesVersion?: string;
  /** Set when a server restart cut the run off and it was started again (same record, not a new one). */
  resumedAt?: string;
}

export interface AdSetAuditRecord {
  id: string;
  metaAdSetId: string;
  name: string;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  bidStrategy: string | null;
  optimizationGoal: string | null;
  isDynamicCreative: boolean | null;
  publisherPlatforms: string[] | null;
  frequencyCap: string | null;
  locations: string | null;
  excludedLocations: string | null;
  rawSnapshot: unknown;
}

export interface AdAuditRecord {
  id: string;
  metaAdSetId: string | null;
  metaAdId: string;
  name: string;
  effectiveStatus: string | null;
  creativeId: string | null;
  primaryText: string | null;
  headline: string | null;
  ctaType: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  permalinkUrl: string | null;
  rawSnapshot: unknown;
}

/** One campaign in one run, with its check results, ad sets and ads. Stored in the run's own file. */
export interface CampaignAuditRecord {
  id: string;
  runId: string;
  adAccountId: string;
  metaCampaignId: string;
  name: string;
  objectiveRaw: string;
  objective: ObjectiveLabel;
  effectiveStatus: string | null;
  /** Delivering or why not (absent on older audits). */
  delivery?: DeliveryState | null;
  currency: string;
  spend7d: number;
  mainMetricKind: MetricKind | null;
  mainMetricValue: number | null;
  rating: Rating;
  ratingIndicative: boolean;
  ratingNote: string | null;
  leadsBaselineCpl: number | null;
  buyingType: string | null;
  bidStrategy: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startTime: string | null;
  rawSnapshot: unknown;
  createdAt: string;
  checks: CheckResult[];
  adSets: AdSetAuditRecord[];
  ads: AdAuditRecord[];
}

/** Finds a campaign audit (and its ads) without opening every run file. */
export interface CampaignIndexRecord {
  id: string;
  runId: string;
  metaCampaignId: string;
  adIds: string[];
}

/** id = `${metaCampaignId}|${itemKey}`. No record = Pending. */
export interface ManualVerificationRecord {
  id: string;
  metaCampaignId: string;
  itemKey: string;
  status: Exclude<ManualStatus, 'PENDING'>;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ManualEventRecord {
  id: string;
  metaCampaignId: string;
  itemKey: string;
  status: ManualStatus;
  note: string | null;
  userId: string | null;
  createdAt: string;
}

/** Evidence file attached to a manual check. The bytes live in data/attachments/<id>. */
export interface AttachmentRecord {
  id: string;
  metaCampaignId: string;
  itemKey: string;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  uploadedBy: string | null;
  uploadedAt: string;
}

/** An exported report, kept in data/reports/<id>.<format> so it can be downloaded again. */
export interface GeneratedReportRecord {
  id: string;
  dataset: string;
  format: 'pdf' | 'xlsx' | 'docx' | 'csv';
  title: string;
  fileName: string;
  size: number;
  sha256: string;
  createdAt: string;
  createdBy: string | null;
  scope: 'filtered' | 'all';
  params: Record<string, string>;
  runId: string | null;
  devData: boolean;
}
