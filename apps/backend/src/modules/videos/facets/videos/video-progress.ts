import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { videoIdSchema } from "../../domain/video-identifiers.js";
import { progressIdentityInput, progressManyInput, saveProgressInput } from "./video-inputs.js";
import {
  dependencyUnavailable,
  invalidRequest,
  videoNotReady,
  type VideoContext,
} from "./video-records.js";
import { isVideoDeletionState, type Videos } from "./videos.interface.js";

// Playback progress of one account per Video.

export async function loadVideoProgressMany(
  context: VideoContext,
  input: Parameters<Videos["loadProgressMany"]>[0],
): ReturnType<Videos["loadProgressMany"]> {
  const parsed = progressManyInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const rows = await context.prisma.videoPlaybackProgress.findMany({ where: { accountId: parsed.data.accountId, videoId: { in: parsed.data.videoIds } }, select: { videoId: true, positionSeconds: true, durationSeconds: true } });
    return { ok: true, value: rows.map((row) => ({ videoId: videoIdSchema.parse(row.videoId), positionSeconds: row.positionSeconds, durationSeconds: row.durationSeconds })) };
  } catch (error) { return dependencyFailure({ module: "videos", operation: "loadProgressMany" }, error, dependencyUnavailable()); }
}

export async function loadVideoProgress(
  context: VideoContext,
  input: Parameters<Videos["loadProgress"]>[0],
): ReturnType<Videos["loadProgress"]> {
  const parsed = progressIdentityInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const progress = await context.prisma.videoPlaybackProgress.findUnique({
      where: { accountId_videoId: parsed.data },
    });
    return { ok: true, value: progress === null ? null : { positionSeconds: progress.positionSeconds } };
  } catch (error) {
    return dependencyFailure({ module: "videos", operation: "loadProgress" }, error, dependencyUnavailable());
  }
}

export async function saveVideoProgress(
  context: VideoContext,
  input: Parameters<Videos["saveProgress"]>[0],
): ReturnType<Videos["saveProgress"]> {
  const parsed = saveProgressInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const video = await context.prisma.video.findUnique({
      select: { state: true },
      where: { id: parsed.data.videoId },
    });
    if (video === null || isVideoDeletionState(video.state)) return videoNotReady();
    await context.prisma.videoPlaybackProgress.upsert({
      where: { accountId_videoId: { accountId: parsed.data.accountId, videoId: parsed.data.videoId } },
      create: { ...parsed.data, updatedAt: context.now() },
      update: { durationSeconds: parsed.data.durationSeconds, positionSeconds: parsed.data.positionSeconds, updatedAt: context.now() },
    });
    return { ok: true, value: undefined };
  } catch (error) {
    return dependencyFailure({ module: "videos", operation: "saveProgress" }, error, dependencyUnavailable());
  }
}
