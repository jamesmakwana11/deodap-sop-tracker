/** Export catalogue shared by the server (which builds reports) and the client (which offers them). */

export const EXPORT_FORMATS = ['pdf', 'xlsx', 'docx', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  pdf: 'PDF',
  xlsx: 'Excel (.xlsx)',
  docx: 'Word (.docx)',
  csv: 'CSV',
};

export type ExportDatasetId =
  | 'dashboard'
  | 'tracker'
  | 'campaign'
  | 'adsets'
  | 'creatives'
  | 'rules'
  | 'failed'
  | 'manual'
  | 'accounts'
  | 'objectives'
  | 'performance'
  | 'history'
  | 'comparison';

export interface ExportDatasetInfo {
  id: ExportDatasetId;
  title: string;
  description: string;
  /** What "current filters" means for this report. */
  filteredLabel: string;
  allLabel: string;
}

export const EXPORT_DATASETS: Record<ExportDatasetId, ExportDatasetInfo> = {
  dashboard: { id: 'dashboard', title: 'Dashboard report', description: 'Totals, account and objective summaries, rule failures and every campaign.', filteredLabel: 'Current filters', allLabel: 'All campaigns in this audit' },
  tracker: { id: 'tracker', title: 'Campaign tracker', description: 'One row per campaign with every SOP check.', filteredLabel: 'Current filters', allLabel: 'All campaigns in this audit' },
  campaign: { id: 'campaign', title: 'Campaign detail', description: 'Checks, settings, ad sets, ads, manual checks and history of one campaign.', filteredLabel: 'This campaign', allLabel: 'This campaign' },
  adsets: { id: 'adsets', title: 'Ad set details', description: 'Budget, bidding, placements, frequency and locations of each active ad set.', filteredLabel: 'Current selection', allLabel: 'All ad sets in this audit' },
  creatives: { id: 'creatives', title: 'Creative audit', description: 'Primary text, headline and call-to-action of each active ad.', filteredLabel: 'Current selection', allLabel: 'All ads in this audit' },
  rules: { id: 'rules', title: 'SOP rules and compliance', description: 'The rule set, results per rule and the check matrix per campaign.', filteredLabel: 'Current filters', allLabel: 'All campaigns in this audit' },
  failed: { id: 'failed', title: 'Failed checks', description: 'Every failed automated and manual check with its finding.', filteredLabel: 'Current filters', allLabel: 'All campaigns in this audit' },
  manual: { id: 'manual', title: 'Manual verification', description: 'Status, notes, evidence files and change log of each manual check.', filteredLabel: 'Current selection', allLabel: 'All campaigns in this audit' },
  accounts: { id: 'accounts', title: 'Account-wise report', description: 'Summary per ad account and its campaigns.', filteredLabel: 'Current filters', allLabel: 'All campaigns in this audit' },
  objectives: { id: 'objectives', title: 'Objective-wise report', description: 'Summary per objective and its campaigns.', filteredLabel: 'Current filters', allLabel: 'All campaigns in this audit' },
  performance: { id: 'performance', title: 'Performance report', description: 'Ratings, main metrics, spend and the rating rules.', filteredLabel: 'Current filters', allLabel: 'All campaigns in this audit' },
  history: { id: 'history', title: 'Audit history', description: 'Every audit run with its totals and account results.', filteredLabel: 'Selected dates', allLabel: 'All audits' },
  comparison: { id: 'comparison', title: 'Historical comparison', description: 'Changes in ratings and SOP compliance between two audits.', filteredLabel: 'Current filters', allLabel: 'All campaigns' },
};

export interface GeneratedReportInfo {
  id: string;
  dataset: ExportDatasetId;
  format: ExportFormat;
  title: string;
  fileName: string;
  size: number;
  createdAt: string;
  createdBy: string | null;
  scope: 'filtered' | 'all';
  devData: boolean;
}
