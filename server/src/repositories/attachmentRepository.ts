import { createHash, randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { AttachmentInfo } from '@sop/shared';
import { writeBinary } from '../storage/jsonFiles.js';
import type { AttachmentRecord } from '../storage/records.js';
import { store } from '../storage/store.js';

/** Evidence files are stored under a random name; the original file name is only metadata. */
export const attachmentPath = (r: AttachmentRecord) => store.path('attachments', r.id);

const userName = (id: string | null) => (id ? (store.c.users.get(id)?.name ?? null) : null);

export function toAttachmentInfo(r: AttachmentRecord): AttachmentInfo {
  return { id: r.id, fileName: r.fileName, contentType: r.contentType, size: r.size, uploadedBy: userName(r.uploadedBy), uploadedAt: r.uploadedAt };
}

export function attachmentsFor(metaCampaignId: string, itemKey?: string): AttachmentRecord[] {
  return store.c.attachments
    .filter((a) => a.metaCampaignId === metaCampaignId && (!itemKey || a.itemKey === itemKey))
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

export async function saveAttachment(input: {
  metaCampaignId: string;
  itemKey: string;
  fileName: string;
  contentType: string;
  data: Buffer;
  userId: string;
}): Promise<AttachmentRecord> {
  const id = randomBytes(16).toString('hex');
  const record: AttachmentRecord = {
    id,
    metaCampaignId: input.metaCampaignId,
    itemKey: input.itemKey,
    fileName: input.fileName,
    contentType: input.contentType,
    size: input.data.length,
    sha256: createHash('sha256').update(input.data).digest('hex'),
    uploadedBy: input.userId,
    uploadedAt: new Date().toISOString(),
  };
  await writeBinary(attachmentPath(record), input.data); // file first, so a record never points at nothing
  await store.c.attachments.insert(record);
  return record;
}

export async function deleteAttachment(id: string): Promise<boolean> {
  const r = store.c.attachments.get(id);
  if (!r) return false;
  await store.c.attachments.remove((a) => a.id === id);
  await rm(attachmentPath(r), { force: true });
  return true;
}
