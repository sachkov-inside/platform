import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  providerVideoIdSchema,
  videoIdSchema,
  videoMaterialIdSchema,
} from "../../domain/video-identifiers.js";
import {
  accessFactsInput,
  presentationInput,
  primaryReferenceInput,
  readyDurationsInput,
  unselectedUploadInput,
} from "./video-inputs.js";
import {
  dependencyUnavailable,
  invalidRequest,
  parseVideoState,
  projectForAccess,
  providerMismatch,
  toAuthoringPresentation,
  videoNotFound,
  videoNotReady,
  type VideoContext,
} from "./video-records.js";
import { videoAccessSchema, type Videos } from "./videos.interface.js";

// Reads of Videos for Materials, authoring, access decisions and playback.

export async function inspectPrimaryVideoReference(
  context: VideoContext,
  transaction: Parameters<Videos["inspectPrimaryReference"]>[0],
  input: Parameters<Videos["inspectPrimaryReference"]>[1],
): ReturnType<Videos["inspectPrimaryReference"]> {
  const parsed = primaryReferenceInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const video = await transaction.video.findUnique({
      where: { id: parsed.data.videoId },
    });
    if (video === null) return videoNotFound();
    if (
      videoMaterialIdSchema.parse(video.materialId) !==
        parsed.data.materialId ||
      video.access !== parsed.data.access ||
      video.projectId !== projectForAccess(context.projects, parsed.data.access)
    ) {
      return providerMismatch();
    }
    return video.state === "ready"
      ? { ok: true, value: undefined }
      : videoNotReady();
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "inspectPrimaryReference" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadVideoPresentation(
  context: VideoContext,
  input: Parameters<Videos["loadPresentation"]>[0],
): ReturnType<Videos["loadPresentation"]> {
  const parsed = presentationInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const video = await context.prisma.video.findFirst({
      where: { id: parsed.data.videoId, materialId: parsed.data.materialId },
    });
    return {
      ok: true,
      value:
        video === null
          ? null
          : {
              videoId: videoIdSchema.parse(video.id),
              title: video.title,
              state: parseVideoState(video.state),
              ...(video.durationSeconds === null
                ? {}
                : { durationSeconds: video.durationSeconds }),
              ...(video.failureCode === null
                ? {}
                : { failureCode: video.failureCode }),
            },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "loadPresentation" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadVideoAuthoringPresentation(
  context: VideoContext,
  input: Parameters<Videos["loadAuthoringPresentation"]>[0],
  transaction: Parameters<
    Videos["loadAuthoringPresentation"]
  >[1] = context.prisma,
): ReturnType<Videos["loadAuthoringPresentation"]> {
  const parsed = presentationInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const video = await transaction.video.findFirst({
      where: { id: parsed.data.videoId, materialId: parsed.data.materialId },
    });
    return {
      ok: true,
      value: video === null ? null : toAuthoringPresentation(video),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "loadAuthoringPresentation" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadReadyVideoDurations(
  context: VideoContext,
  videoIds: Parameters<Videos["loadReadyDurations"]>[0],
): ReturnType<Videos["loadReadyDurations"]> {
  const parsed = readyDurationsInput.safeParse(videoIds);
  if (!parsed.success) return invalidRequest();
  if (parsed.data.length === 0) return { ok: true, value: [] };
  try {
    const rows = await context.prisma.video.findMany({
      select: { durationSeconds: true, id: true },
      where: {
        durationSeconds: { not: null },
        id: { in: [...new Set(parsed.data)] },
        state: "ready",
      },
    });
    return {
      ok: true,
      value: rows.flatMap(({ durationSeconds, id }) =>
        durationSeconds === null
          ? []
          : [{ durationSeconds, videoId: videoIdSchema.parse(id) }],
      ),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "loadReadyDurations" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadLatestVideoDeletion(
  context: VideoContext,
  materialId: Parameters<Videos["loadLatestDeletion"]>[0],
): ReturnType<Videos["loadLatestDeletion"]> {
  const parsed = videoMaterialIdSchema.safeParse(materialId);
  if (!parsed.success) return invalidRequest();
  try {
    const video = await context.prisma.video.findFirst({
      orderBy: { updatedAt: "desc" },
      where: {
        materialId: parsed.data,
        state: {
          in: ["deletion_requested", "deleting", "deleted", "delete_failed"],
        },
      },
    });
    return {
      ok: true,
      value: video === null ? null : toAuthoringPresentation(video),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "loadLatestDeletion" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadUnselectedVideoUpload(
  context: VideoContext,
  input: Parameters<Videos["loadUnselectedUpload"]>[0],
): ReturnType<Videos["loadUnselectedUpload"]> {
  const parsed = unselectedUploadInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  // A Material that already selected a Video has nothing to recover.
  if (parsed.data.selectedVideoId !== null) return { ok: true, value: null };
  try {
    const video = await context.prisma.video.findFirst({
      // Attempts are ordered by when the author started them; a provider sync moves updatedAt.
      orderBy: { createdAt: "desc" },
      where: {
        materialId: parsed.data.materialId,
        origin: "platform_upload",
        // A resolved upload was already shown to its author, who may have detached it on
        // purpose. Only an outcome Platform never settled is still waiting to be recovered.
        state: { in: ["uploading", "processing"] },
        // An upload the author removed before it settled is their decision too, whatever
        // Kinescope reports later.
        detachedAt: null,
      },
    });
    return {
      ok: true,
      value: video === null ? null : toAuthoringPresentation(video),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "loadUnselectedUpload" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadVideoAccessFacts(
  context: VideoContext,
  videoIds: Parameters<Videos["loadAccessFacts"]>[0],
): ReturnType<Videos["loadAccessFacts"]> {
  const parsed = accessFactsInput.safeParse(videoIds);
  if (!parsed.success) return invalidRequest();
  try {
    const videos = await context.prisma.video.findMany({
      where: { id: { in: parsed.data } },
    });
    return {
      ok: true,
      value: videos.map((video) => ({
        access: videoAccessSchema.parse(video.access),
        materialId: videoMaterialIdSchema.parse(video.materialId),
        videoId: videoIdSchema.parse(video.id),
      })),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "loadAccessFacts" },
      error,
      dependencyUnavailable(),
    );
  }
}

export async function loadVideoPlayback(
  context: VideoContext,
  videoId: Parameters<Videos["loadPlayback"]>[0],
): ReturnType<Videos["loadPlayback"]> {
  const parsed = videoIdSchema.safeParse(videoId);
  if (!parsed.success) return invalidRequest();
  try {
    const video = await context.prisma.video.findUnique({
      where: { id: parsed.data },
    });
    if (video === null) return { ok: true, value: null };
    if (video.state !== "ready" || video.providerEmbedLocator === null)
      return videoNotReady();
    return {
      ok: true,
      value: {
        access: videoAccessSchema.parse(video.access),
        embedLocator: video.providerEmbedLocator,
        materialId: videoMaterialIdSchema.parse(video.materialId),
        providerVideoId: providerVideoIdSchema.parse(video.providerVideoId),
        videoId: videoIdSchema.parse(video.id),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "loadPlayback" },
      error,
      dependencyUnavailable(),
    );
  }
}
