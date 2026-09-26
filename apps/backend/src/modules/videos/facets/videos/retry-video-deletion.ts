import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { retryDeletionInput } from "./video-inputs.js";
import {
  dependencyUnavailable,
  forbidden,
  invalidRequest,
  toDto,
  videoDeletionNotRetryable,
  videoNotFound,
  type VideoContext,
} from "./video-records.js";
import type { Videos } from "./videos.interface.js";

// Returns a failed deletion of an owned upload to the deletion worker's queue.

export async function retryVideoDeletion(
  context: VideoContext,
  input: Parameters<Videos["retryDeletion"]>[0],
): ReturnType<Videos["retryDeletion"]> {
  const parsed = retryDeletionInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  if (!(await context.managerAllowed(parsed.data.actor))) return forbidden();
  try {
    const retriedAt = context.now();
    return await context.prisma.$transaction(async (transaction) => {
      const video = await transaction.video.findUnique({
        include: { deletionOperation: true },
        where: { id: parsed.data.videoId },
      });
      if (video === null) return videoNotFound();
      if (
        video.origin !== "platform_upload" ||
        video.state !== "delete_failed" ||
        video.deletionOperation?.state !== "delete_failed"
      )
        return videoDeletionNotRetryable();
      await transaction.videoDeletionOperation.update({
        data: {
          cycleAttempts: 0,
          claimedAt: null,
          lastErrorCategory: null,
          nextAttemptAt: retriedAt,
          providerRequestId: null,
          state: "deletion_requested",
          updatedAt: retriedAt,
        },
        where: { id: video.deletionOperation.id },
      });
      const updated = await transaction.video.update({
        data: {
          failureCode: null,
          state: "deletion_requested",
          updatedAt: retriedAt,
        },
        where: { id: video.id },
      });
      return { ok: true as const, value: toDto(updated) };
    });
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "retryDeletion" },
      error,
      dependencyUnavailable(),
    );
  }
}
