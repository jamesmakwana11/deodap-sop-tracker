import { MANUAL_CHECK_ITEMS, type ManualCheckKey, type ManualCheckState, type ManualEvent, type ManualStatus } from '@sop/shared';
import { store } from '../storage/store.js';
import { attachmentsFor, toAttachmentInfo } from './attachmentRepository.js';

const userName = (id: string | null) => (id ? (store.c.users.get(id)?.name ?? null) : null);

export async function getManualChecks(metaCampaignId: string): Promise<ManualCheckState[]> {
  const byKey = new Map(store.c.manualChecks.filter((m) => m.metaCampaignId === metaCampaignId).map((m) => [m.itemKey, m]));
  return MANUAL_CHECK_ITEMS.map((item) => {
    const r = byKey.get(item.key);
    return {
      key: item.key,
      label: item.label,
      help: item.help,
      status: r?.status ?? 'PENDING',
      note: r?.note ?? null,
      updatedBy: r ? userName(r.updatedBy) : null,
      updatedAt: r?.updatedAt ?? null,
      attachments: attachmentsFor(metaCampaignId, item.key).map(toAttachmentInfo),
    };
  });
}

export async function getManualEvents(metaCampaignId: string, limit = 50): Promise<ManualEvent[]> {
  return store.c.manualEvents
    .filter((e) => e.metaCampaignId === metaCampaignId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id))
    .slice(0, limit)
    .map((e) => ({ key: e.itemKey as ManualCheckKey, status: e.status, note: e.note, user: userName(e.userId), at: e.createdAt }));
}

/** Sets one item. PENDING removes the verification. Every change is logged. */
export async function setManualCheck(
  metaCampaignId: string,
  key: ManualCheckKey,
  status: ManualStatus,
  note: string | null,
  userId: string,
): Promise<void> {
  const id = `${metaCampaignId}|${key}`;
  const at = new Date().toISOString();
  if (status === 'PENDING') await store.c.manualChecks.remove((m) => m.id === id);
  else await store.c.manualChecks.put({ id, metaCampaignId, itemKey: key, status, note, updatedBy: userId, updatedAt: at });
  await store.c.manualEvents.insert({ metaCampaignId, itemKey: key, status, note, userId, createdAt: at });
}

export async function campaignExists(metaCampaignId: string): Promise<boolean> {
  return store.c.campaignIndex.find((x) => x.metaCampaignId === metaCampaignId) !== undefined;
}
