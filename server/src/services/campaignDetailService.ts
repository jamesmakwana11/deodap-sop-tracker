import {
  computeCompliance,
  type AdDetail,
  type AdSetDetail,
  type CampaignDetailResponse,
  type CampaignHistoryPoint,
} from '@sop/shared';
import { badRequest, notFoundError } from '../http/errors.js';
import { findCampaignAuditRow, findCompletedRun, toCampaignAudit } from '../repositories/auditRepository.js';
import { getManualChecks, getManualEvents } from '../repositories/manualRepository.js';
import type { AdAuditRecord, AdSetAuditRecord } from '../storage/records.js';
import { store } from '../storage/store.js';
import { clientForConnection } from './metaConnectionService.js';

const toAdSetDetail = ({ rawSnapshot: _raw, ...a }: AdSetAuditRecord): AdSetDetail => a;
const toAdDetail = ({ rawSnapshot: _raw, ...a }: AdAuditRecord): AdDetail => a;

export async function getCampaignDetail(campaignAuditId: string): Promise<CampaignDetailResponse> {
  const row = await findCampaignAuditRow(campaignAuditId);
  if (!row) throw notFoundError('Campaign audit not found.');
  const r = row.record;
  const run = await findCompletedRun(r.runId);
  if (!run) throw notFoundError('This campaign belongs to a run that did not complete.');

  return {
    audit: toCampaignAudit(row),
    run,
    settings: {
      buyingType: r.buyingType,
      bidStrategy: r.bidStrategy,
      dailyBudget: r.dailyBudget,
      lifetimeBudget: r.lifetimeBudget,
      startTime: r.startTime,
      effectiveStatus: r.effectiveStatus,
    },
    adSets: r.adSets.map(toAdSetDetail).sort((a, b) => a.name.localeCompare(b.name)),
    ads: r.ads.map(toAdDetail).sort((a, b) => a.name.localeCompare(b.name)),
    manualChecks: await getManualChecks(r.metaCampaignId),
    manualEvents: await getManualEvents(r.metaCampaignId),
    history: await campaignHistory(r.metaCampaignId, run.source),
  };
}

/** This campaign across completed runs of the same source, oldest first (last 60). */
async function campaignHistory(metaCampaignId: string, source: string): Promise<CampaignHistoryPoint[]> {
  const entries = store.c.campaignIndex
    .filter((x) => x.metaCampaignId === metaCampaignId)
    .map((x) => ({ x, run: store.c.auditRuns.get(x.runId) }))
    .filter(({ run }) => run && run.source === source && (run.status === 'succeeded' || run.status === 'partial'))
    .sort((a, b) => b.run!.startedAt.localeCompare(a.run!.startedAt))
    .slice(0, 60);

  const points: CampaignHistoryPoint[] = [];
  for (const { x, run } of entries) {
    const rec = (await store.readRunAudits(x.runId)).find((c) => c.id === x.id);
    if (!rec) continue;
    const compliance = computeCompliance(rec.checks);
    points.push({
      campaignAuditId: rec.id,
      runId: run!.id,
      at: run!.finishedAt ?? run!.startedAt,
      rating: rec.rating,
      spend7d: rec.spend7d,
      mainMetric: rec.mainMetricKind ? { kind: rec.mainMetricKind, value: rec.mainMetricValue } : null,
      sopPercent: compliance.percent,
      sopStatus: compliance.status,
    });
  }
  return points.sort((a, b) => a.at.localeCompare(b.at));
}

export const PREVIEW_FORMATS = ['MOBILE_FEED_STANDARD', 'DESKTOP_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY'] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number];

/**
 * Asks Meta for an ad preview (read-only). Meta returns an <iframe> pointing at facebook.com;
 * only that URL is passed on, after checking its host.
 */
export async function getAdPreview(adAuditId: string, format: PreviewFormat): Promise<{ src: string }> {
  const entry = store.c.campaignIndex.find((x) => x.adIds.includes(adAuditId));
  const campaign = entry && (await store.readRunAudits(entry.runId)).find((c) => c.id === entry.id);
  const ad = campaign?.ads.find((a) => a.id === adAuditId);
  if (!campaign || !ad) throw notFoundError('Ad not found.');
  const account = store.c.adAccounts.get(campaign.adAccountId);
  if (!account || account.isDevData || !account.connectionId) throw badRequest('A live preview needs a connected Meta account.');

  const graph = await clientForConnection(account.connectionId);
  const res = await graph.get<{ data: { body?: string }[] }>(`${ad.metaAdId}/previews`, { ad_format: format });
  const html = res.data[0]?.body ?? '';
  const match = /src="([^"]+)"/.exec(html);
  const src = match?.[1]?.replace(/&amp;/g, '&');
  if (!src) throw notFoundError('Meta did not return a preview for this ad and format.');
  const host = new URL(src).hostname;
  if (!(host === 'facebook.com' || host.endsWith('.facebook.com'))) throw badRequest('Unexpected preview host from Meta.');
  return { src };
}
