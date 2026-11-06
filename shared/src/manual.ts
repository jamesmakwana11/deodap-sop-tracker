/** SOP items Meta data cannot verify. A person must confirm each; none is ever passed automatically. */
export const MANUAL_CHECK_ITEMS = [
  { key: 'creative_approval', label: 'Creative team approval', help: 'The creative was approved by the creative team before launch.' },
  { key: 'next_day_launch', label: 'Next-day launch', help: 'The campaign was scheduled to go live the next day, as the SOP requires.' },
  { key: 'stock', label: 'Stock verification', help: 'Advertised products are in stock.' },
  { key: 'copy', label: 'Copy accuracy', help: 'Primary text, headline and offer wording are correct.' },
  { key: 'sku', label: 'SKU accuracy', help: 'The advertised SKUs match the landing page and catalogue.' },
  { key: 'coupon', label: 'Coupon accuracy', help: 'Any coupon code in the ad is valid and correct.' },
  { key: 'custom_audience_exclusions', label: 'Custom audience exclusions', help: 'The required custom audiences are excluded.' },
] as const;

export type ManualCheckKey = (typeof MANUAL_CHECK_ITEMS)[number]['key'];
export type ManualStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'NOT_APPLICABLE';

export interface AttachmentInfo {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedBy: string | null;
  uploadedAt: string;
}

/** Evidence files accepted for manual checks. */
export const ATTACHMENT_TYPES: Record<string, string> = {
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'image/webp': 'WebP image',
  'image/gif': 'GIF image',
  'application/pdf': 'PDF',
  'text/plain': 'Text',
  'text/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
};
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** File extension → accepted type, for browsers that send a generic type (e.g. CSV on Windows). */
export const ATTACHMENT_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export interface ManualCheckState {
  key: ManualCheckKey;
  label: string;
  help: string;
  status: ManualStatus;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  attachments: AttachmentInfo[];
}

export interface ManualSummary {
  verified: number;
  failed: number;
  notApplicable: number;
  pending: number;
}

export interface ManualEvent {
  key: ManualCheckKey;
  status: ManualStatus;
  note: string | null;
  user: string | null;
  at: string;
}
