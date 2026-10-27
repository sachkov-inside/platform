import { z } from "zod";

import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { videosTransaction } from "../../infrastructure/transaction.js";
import { isVideoDeletionState } from "../../facets/videos/videos.interface.js";
import {
  newVideoDeletionOperationId,
  videoAccountIdSchema,
  videoIdSchema,
  videoMaterialIdSchema,
} from "../../domain/video-identifiers.js";

const requestInput = z
  .object({
    actor: videoAccountIdSchema,
    materialId: videoMaterialIdSchema,
    videoId: videoIdSchema,
  })
  .strict();

export type RequestVideoDeletionResult =
  | Readonly<{ ok: true; operationId: string }>
  | Readonly<{
      ok: false;
      code:
        | "invalid_request"
        | "video_deletion_already_requested"
        | "video_deletion_forbidden"
        | "video_not_found";
    }>;

export async function requestVideoDeletion(
  handle: TransactionHandle,
  input: {
    readonly actor: string;
    readonly materialId: string;
    readonly videoId: string;
  },
  requestedAt: Date,
): Promise<RequestVideoDeletionResult> {
  const prisma = videosTransaction(handle);
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) return { code: "invalid_request", ok: false };
  const video = await prisma.video.findUnique({
    where: { id: parsed.data.videoId },
  });
  if (video === null || video.materialId !== parsed.data.materialId) {
    return { code: "video_not_found", ok: false };
  }
  if (video.origin !== "platform_upload") {
    return { code: "video_deletion_forbidden", ok: false };
  }
  if (isVideoDeletionState(video.state)) {
    return { code: "video_deletion_already_requested", ok: false };
  }
  const operationId = newVideoDeletionOperationId();
  await prisma.videoDeletionOperation.create({
    data: {
      id: operationId,
      materialId: parsed.data.materialId,
      nextAttemptAt: requestedAt,
      requestedAt,
      requestedBy: parsed.data.actor,
      state: "deletion_requested",
      updatedAt: requestedAt,
      videoId: parsed.data.videoId,
    },
  });
  await prisma.video.update({
    data: {
      failureCode: null,
      state: "deletion_requested",
      updatedAt: requestedAt,
    },
    where: { id: parsed.data.videoId },
  });
  return { ok: true, operationId };
}
