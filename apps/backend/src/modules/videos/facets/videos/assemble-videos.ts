import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { VideosPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { VideoAccountId } from "../../domain/video-identifiers.js";
import type { VideoProvider } from "../../ports/video-provider.js";
import { attachExistingVideo } from "./attach-video.js";
import {
  inspectPrimaryVideoReference,
  loadLatestVideoDeletion,
  loadReadyVideoDurations,
  loadUnselectedVideoUpload,
  loadVideoAccessFacts,
  loadVideoAuthoringPresentation,
  loadVideoPlayback,
  loadVideoPresentation,
} from "./read-videos.js";
import { acceptVideoWebhook, reconcileVideo } from "./reconcile-video.js";
import { retryVideoDeletion } from "./retry-video-deletion.js";
import { initVideoUpload } from "./upload-video.js";
import { loadVideoProgress, loadVideoProgressMany, saveVideoProgress } from "./video-progress.js";
import type { VideoContext } from "./video-records.js";
import type { Videos } from "./videos.interface.js";

export function assembleVideos(dependencies: {
  readonly canManage: (accountId: VideoAccountId) => Promise<boolean>;
  readonly prisma: VideosPrismaClient;
  readonly provider: VideoProvider;
  readonly projects: Readonly<Record<"free" | "membership", string>>;
  readonly clock?: () => Date;
}): Videos {
  const context: VideoContext = {
    async managerAllowed(actor) {
      try {
        return await dependencies.canManage(actor);
      } catch (error) {
        return dependencyFailure({ module: "videos", operation: "managerAllowed" }, error, false);
      }
    },
    now: dependencies.clock ?? (() => new Date()),
    prisma: dependencies.prisma,
    projects: dependencies.projects,
    provider: dependencies.provider,
  };
  return Object.freeze({
    acceptWebhook: (input) => acceptVideoWebhook(context, input),
    attachExisting: (input) => attachExistingVideo(context, input),
    initUpload: (input) => initVideoUpload(context, input),
    inspectPrimaryReference: (transaction, input) => inspectPrimaryVideoReference(context, transaction, input),
    loadAccessFacts: (videoIds) => loadVideoAccessFacts(context, videoIds),
    loadAuthoringPresentation: (input, transaction) => loadVideoAuthoringPresentation(context, input, transaction),
    loadLatestDeletion: (materialId) => loadLatestVideoDeletion(context, materialId),
    loadPlayback: (videoId) => loadVideoPlayback(context, videoId),
    loadPresentation: (input) => loadVideoPresentation(context, input),
    loadProgress: (input) => loadVideoProgress(context, input),
    loadProgressMany: (input) => loadVideoProgressMany(context, input),
    loadReadyDurations: (videoIds) => loadReadyVideoDurations(context, videoIds),
    loadUnselectedUpload: (input) => loadUnselectedVideoUpload(context, input),
    reconcile: (input) => reconcileVideo(context, input),
    retryDeletion: (input) => retryVideoDeletion(context, input),
    saveProgress: (input) => saveVideoProgress(context, input),
  } satisfies Videos);
}
