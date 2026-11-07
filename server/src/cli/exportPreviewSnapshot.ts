/**
 * Writes the data for the static preview build (client: npm run build:preview).
 * Only DEVELOPMENT data is exported, so a shared preview can never contain real Meta results.
 *   npm run db:seed:dev && npm run preview:snapshot
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CampaignDetailResponse, MetaStatusResponse } from '@sop/shared';
import { env } from '../config/env.js';
import { closeStore, openStore, store } from '../storage/store.js';
import { findRun } from '../repositories/runRepository.js';
import { getCampaignDetail } from '../services/campaignDetailService.js';
import { getDashboard } from '../services/dashboardService.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../client/src/preview/snapshot.json');

async function main() {
  const runId = store.c.auditRuns
    .filter((r) => r.source === 'development' && r.status === 'succeeded')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.id;
  if (!runId) throw new Error('No development run found. Run "npm run db:seed:dev" first.');

  const dashboard = await getDashboard(runId);
  if (dashboard.run?.source !== 'development') throw new Error('Refusing to export non-development data.');

  const details: Record<string, CampaignDetailResponse> = {};
  for (const c of dashboard.campaigns) {
    const d = await getCampaignDetail(c.id);
    // Manual checks start fresh in the preview; nobody has verified sample data.
    details[c.id] = {
      ...d,
      manualChecks: d.manualChecks.map((m) => ({ ...m, status: 'PENDING', note: null, updatedBy: null, updatedAt: null })),
      manualEvents: [],
      history: d.history.filter((h) => h.runId === runId),
      audit: { ...d.audit, manual: { verified: 0, failed: 0, notApplicable: 0, pending: d.manualChecks.length } },
    };
  }
  for (const c of dashboard.campaigns) {
    c.manual = details[c.id]!.audit.manual;
    c.whatIsOff = c.whatIsOff.filter((w) => !w.startsWith('Manual check failed'));
  }

  const meta: MetaStatusResponse = {
    oauthConfigured: false,
    tokenStorageConfigured: false,
    graphVersion: env.META_GRAPH_VERSION,
    connections: [],
    accounts: [],
    schedule: { timeIst: '07:30', nextRunAt: null },
    app: { appId: null, hasAppSecret: false, redirectUri: '', redirectUriSource: 'detected', detectedRedirectUri: '', fixedRedirectUri: null, ignoredFixedRedirectUri: null, graphVersion: env.META_GRAPH_VERSION, source: 'none' },
    encryptionKey: 'none',
  };
  const run = await findRun(runId);
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), dashboard, details, runs: run ? [run] : [], meta }, null, 1));
  console.log(`Wrote preview snapshot of development run ${runId} to ${OUT}`);
}

openStore()
  .then(main)
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => closeStore());
