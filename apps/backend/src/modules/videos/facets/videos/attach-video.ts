import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockMaterialReferenceChanges,
  type VideosPrisma,
} from "../../../../infrastructure/prisma/index.js";
import {
  newVideoId,
  providerVideoIdSchema,
  videoIdSchema,
} from "../../domain/video-identifiers.js";
import { attachInput } from "./video-inputs.js";
import {
  accessOfProject,
  dependencyUnavailable,
  forbidden,
  invalidRequest,
  providerLifecycle,
  providerMismatch,
  recordingServesAccess,
  toDto,
  type VideoContext,
} from "./video-records.js";
import { isVideoDeletionState, type Videos } from "./videos.interface.js";
import {
  markPendingWebhooksReconciled,
  reconcilePendingWebhooks,
} from "./reconcile-video.js";

// Attaches a Video that already exists at the provider to a Material, as an External Attachment.
// A recording another Material owns moves to this one with its Video (ADR 0048).

export async function attachExistingVideo(
  context: VideoContext,
  input: Parameters<Videos["attachExisting"]>[0],
): ReturnType<Videos["attachExisting"]> {
  const parsed = attachInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  if (!(await context.managerAllowed(parsed.data.actor))) return forbidden();
  try {
    const reconciliationCutoff = context.now();
    const remote = await context.provider.find({
      id: parsed.data.providerVideoId,
      projectId: context.projects.protected,
    });
    // The provider names the project; it must be one Platform uses and must serve the access.
    const recordingAccess =
      remote === null
        ? null
        : accessOfProject(context.projects, remote.projectId);
    if (
      remote === null ||
      remote.id !== parsed.data.providerVideoId ||
      recordingAccess === null ||
      !recordingServesAccess(recordingAccess, parsed.data.access)
    )
      return providerMismatch();
    const projectId = remote.projectId;
    const duplicate = await context.prisma.video.findFirst({
      where: { providerVideoId: remote.id, projectId },
    });
    if (duplicate !== null) {
      const owned =
        duplicate.materialId === parsed.data.materialId
          ? duplicate
          : await context.prisma.$transaction((transaction) =>
              moveVideo(
                transaction,
                duplicate.id,
                parsed.data.materialId,
                context.now(),
              ),
            );
      if (owned === null) return providerMismatch();
      if (
        !(await reconcilePendingWebhooks(
          context,
          providerVideoIdSchema.parse(owned.providerVideoId),
          videoIdSchema.parse(owned.id),
        ))
      )
        return dependencyUnavailable();
      return { ok: true, value: toDto(owned) };
    }
    const lifecycle = providerLifecycle(remote);
    const savedAt = context.now();
    const saved = await context.prisma.$transaction(async (transaction) => {
      const video = await transaction.video.create({
        data: {
          id: newVideoId(),
          access: recordingAccess,
          createdAt: savedAt,
          createdBy: parsed.data.actor,
          failureCode: lifecycle.failureCode,
          durationSeconds: remote.durationSeconds ?? null,
          lastSyncedAt: savedAt,
          materialId: parsed.data.materialId,
          origin: "external_attachment",
          projectId,
          providerEmbedLocator: lifecycle.embedLocator,
          providerMessage: remote.message ?? null,
          providerStatus: remote.status,
          providerVisibleAt: savedAt,
          providerVideoId: parsed.data.providerVideoId,
          readyAt: lifecycle.state === "ready" ? savedAt : null,
          state: lifecycle.state,
          title: remote.title,
          updatedAt: savedAt,
        },
      });
      await markPendingWebhooksReconciled(
        transaction,
        parsed.data.providerVideoId,
        reconciliationCutoff,
        context.now(),
      );
      return video;
    });
    if (
      !(await reconcilePendingWebhooks(
        context,
        parsed.data.providerVideoId,
        videoIdSchema.parse(saved.id),
      ))
    )
      return dependencyUnavailable();
    return { ok: true, value: toDto(saved) };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "attachExisting" },
      error,
      dependencyUnavailable(),
    );
  }
}

/**
 * Hands the Video to the Material that attaches its recording (ADR 0048). Both Materials' reference
 * locks order the move with their Saves and with Video deletion.
 */
async function moveVideo(
  transaction: VideosPrisma,
  videoId: string,
  materialId: string,
  movedAt: Date,
) {
  const initial = await transaction.video.findUnique({
    where: { id: videoId },
  });
  if (initial === null) return null;
  await lockMaterialReferenceChanges(transaction, [
    initial.materialId,
    materialId,
  ]);
  const video = await transaction.video.findUnique({
    include: { deletionOperation: { select: { id: true } } },
    where: { id: videoId },
  });
  if (video === null) return null;
  if (video.materialId === materialId) return video;
  if (
    // A concurrent move took it elsewhere after the first read: refused like any unmovable Video.
    video.materialId !== initial.materialId ||
    video.state === "uploading" ||
    isVideoDeletionState(video.state) ||
    video.deletionOperation !== null
  )
    return null;
  return transaction.video.update({
    data: { detachedAt: null, materialId, updatedAt: movedAt },
    where: { id: videoId },
  });
}
