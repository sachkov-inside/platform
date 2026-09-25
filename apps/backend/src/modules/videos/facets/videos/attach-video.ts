import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { newVideoId, providerVideoIdSchema, videoIdSchema } from "../../domain/video-identifiers.js";
import { attachInput } from "./video-inputs.js";
import {
  dependencyUnavailable,
  forbidden,
  invalidRequest,
  projectForAccess,
  providerLifecycle,
  providerMismatch,
  toDto,
  type VideoContext,
} from "./video-records.js";
import type { Videos } from "./videos.interface.js";
import { markPendingWebhooksReconciled, reconcilePendingWebhooks } from "./reconcile-video.js";

// Attaches a Video that already exists at the provider to a Material, as an External Attachment.

export async function attachExistingVideo(
  context: VideoContext,
  input: Parameters<Videos["attachExisting"]>[0],
): ReturnType<Videos["attachExisting"]> {
  const parsed = attachInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  if (!(await context.managerAllowed(parsed.data.actor))) return forbidden();
  const projectId = projectForAccess(context.projects, parsed.data.access);
  try {
    const reconciliationCutoff = context.now();
    const remote = await context.provider.find({ id: parsed.data.providerVideoId, projectId });
    if (
      remote === null ||
      remote.id !== parsed.data.providerVideoId ||
      remote.projectId !== projectId
    ) return providerMismatch();
    const duplicate = await context.prisma.video.findFirst({
      where: { providerVideoId: remote.id, projectId },
    });
    if (duplicate !== null) {
      if (duplicate.materialId !== parsed.data.materialId || duplicate.access !== parsed.data.access) {
        return providerMismatch();
      }
      if (!(await reconcilePendingWebhooks(
        context,
        providerVideoIdSchema.parse(duplicate.providerVideoId),
        videoIdSchema.parse(duplicate.id),
      ))) return dependencyUnavailable();
      return { ok: true, value: toDto(duplicate) };
    }
    const lifecycle = providerLifecycle(remote);
    const savedAt = context.now();
    const saved = await context.prisma.$transaction(async (transaction) => {
      const video = await transaction.video.create({
        data: {
          id: newVideoId(),
          access: parsed.data.access,
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
        context,
        transaction,
        parsed.data.providerVideoId,
        reconciliationCutoff,
      );
      return video;
    });
    if (!(await reconcilePendingWebhooks(
      context,
      parsed.data.providerVideoId,
      videoIdSchema.parse(saved.id),
    ))) return dependencyUnavailable();
    return { ok: true, value: toDto(saved) };
  } catch (error) {
    return dependencyFailure({ module: "videos", operation: "attachExisting" }, error, dependencyUnavailable());
  }
}
