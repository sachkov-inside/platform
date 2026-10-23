import { z } from "zod";

import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { videosTransaction } from "../../infrastructure/transaction.js";
import {
  videoIdSchema,
  videoMaterialIdSchema,
} from "../../domain/video-identifiers.js";

const detachmentInput = z
  .object({
    materialId: videoMaterialIdSchema,
    videoIds: z.array(videoIdSchema),
  })
  .strict();

export type RecordVideoDetachmentResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "invalid_request" | "video_not_found" }>;

/**
 * «Убрать» is the author's decision even while Kinescope is still processing the Video. Recording
 * it ends the Video's life as its Material's unselected upload, so a later visit cannot hand the
 * Video back for autosave to select again, whatever the provider answers afterwards. The Kinescope
 * object stays; deleting it remains a separate explicit request.
 */
export async function recordVideoDetachment(
  handle: TransactionHandle,
  input: {
    readonly materialId: string;
    readonly videoIds: readonly string[];
  },
  detachedAt: Date,
): Promise<RecordVideoDetachmentResult> {
  const prisma = videosTransaction(handle);
  const parsed = detachmentInput.safeParse(input);
  if (!parsed.success) return { code: "invalid_request", ok: false };
  const videoIds = [...new Set(parsed.data.videoIds)];
  if (videoIds.length === 0) return { ok: true };
  const owned = await prisma.video.count({
    where: { id: { in: videoIds }, materialId: parsed.data.materialId },
  });
  if (owned !== videoIds.length) return { code: "video_not_found", ok: false };
  // The first detachment is the decision; repeating it, for example on a replayed Save, keeps it.
  await prisma.video.updateMany({
    data: { detachedAt, updatedAt: detachedAt },
    where: { detachedAt: null, id: { in: videoIds } },
  });
  return { ok: true };
}
