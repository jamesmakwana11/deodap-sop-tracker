import type { ObjectiveLabel } from '@sop/shared';

/** Meta objective (current OUTCOME_* and legacy values) → SOP objective. */
const MAP: Record<string, ObjectiveLabel> = {
  OUTCOME_SALES: 'Sales',
  CONVERSIONS: 'Sales',
  PRODUCT_CATALOG_SALES: 'Sales',
  OUTCOME_TRAFFIC: 'Traffic',
  LINK_CLICKS: 'Traffic',
  OUTCOME_AWARENESS: 'Awareness',
  BRAND_AWARENESS: 'Awareness',
  REACH: 'Awareness',
  OUTCOME_ENGAGEMENT: 'Engagement',
  POST_ENGAGEMENT: 'Engagement',
  PAGE_LIKES: 'Engagement',
  EVENT_RESPONSES: 'Engagement',
  VIDEO_VIEWS: 'Engagement',
  MESSAGES: 'Engagement',
  OUTCOME_APP_PROMOTION: 'App Promotion',
  APP_INSTALLS: 'App Promotion',
  OUTCOME_LEADS: 'Leads',
  LEAD_GENERATION: 'Leads',
};

export function mapObjective(raw: string | undefined): ObjectiveLabel {
  return (raw && MAP[raw]) || 'Other';
}
