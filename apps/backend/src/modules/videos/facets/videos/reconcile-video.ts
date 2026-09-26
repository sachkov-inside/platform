import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { VideosPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  newVideoWebhookInboxId,
  providerVideoIdSchema,
  videoIdSchema,
  type ProviderVideoId,
  type VideoId,
} from "../../domain/video-identifiers.js";
import { reconcileInput, webhookInput } from "./video-inputs.js";
import {
  dependencyUnavailable,
  forbidden,
  invalidRequest,
  providerLifecycle,
  providerMismatch,
  toDto,
  videoNotFound,
  type VideoContext,
} from "./video-records.js";
import {
  isVideoDeletionState,
  type AcceptVideoWebhookResult,
  type ReconcileVideoResult,
  type VideoDto,
  type VideoError,
  type VideoResult,
  type Videos,
} from "./videos.interface.js";

// The provider is authoritative for a Video's lifecycle: reconciliation reads it and settles the
// local row, and a webhook is only a durable hint to reconcile.

export async function reconcileVideo(
  context: VideoContext,
  input: Parameters<Videos["reconcile"]>[0],
): Promise<ReconcileVideoResult> {
  const parsed = reconcileInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  if (!(await context.managerAllowed(parsed.data.actor))) return forbidden();
  return reconcileVideoById(context, parsed.data.videoId);
}

export async function acceptVideoWebhook(
  context: VideoContext,
  input: Parameters<Videos["acceptWebhook"]>[0],
): Promise<AcceptVideoWebhookResult> {
  const parsed = webhookInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const receivedAt = context.now();
    await context.prisma.videoWebhookInbox.create({
      data: {
        id: newVideoWebhookInboxId(),
        event: parsed.data.event,
        providerStatus: parsed.data.providerStatus ?? null,
        providerVideoId: parsed.data.providerVideoId,
        receivedAt,
      },
    });
    const local = await context.prisma.video.findFirst({
      where: { providerVideoId: parsed.data.providerVideoId },
    });
    if (local === null) return { ok: true, value: undefined };
    const reconciled = await reconcileVideoById(
      context,
      videoIdSchema.parse(local.id),
    );
    if (!reconciled.ok) return reconciled;
    return { ok: true, value: undefined };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "acceptWebhook" },
      error,
      dependencyUnavailable(),
    );
  }
}

/** Reconciles the Video when a webhook for it is still pending; false when that did not settle. */
export async function reconcilePendingWebhooks(
  context: VideoContext,
  providerVideoId: ProviderVideoId,
  videoId: VideoId,
): Promise<boolean> {
  const cutoff = context.now();
  try {
    const pending = await context.prisma.videoWebhookInbox.findFirst({
      where: {
        providerVideoId,
        reconciledAt: null,
        receivedAt: { lte: cutoff },
      },
    });
    if (pending === null) return true;
    const reconciled = await reconcileVideoById(context, videoId);
    return reconciled.ok;
  } catch (error) {
    // The durable inbox stays pending for the next browser poll or provider retry.
    return dependencyFailure(
      { module: "videos", operation: "reconcilePendingWebhooks" },
      error,
      false,
    );
  }
}

export async function markPendingWebhooksReconciled(
  transaction: Pick<VideosPrismaClient, "videoWebhookInbox">,
  providerVideoId: ProviderVideoId,
  cutoff: Date,
  reconciledAt: Date,
): Promise<void> {
  await transaction.videoWebhookInbox.updateMany({
    where: { providerVideoId, reconciledAt: null, receivedAt: { lte: cutoff } },
    data: { reconciledAt },
  });
}

async function reconcileVideoById(
  context: VideoContext,
  videoId: VideoId,
): Promise<
  VideoResult<
    VideoDto,
    Extract<
      VideoError,
      {
        readonly code:
          "dependency_unavailable" | "provider_mismatch" | "video_not_found";
      }
    >
  >
> {
  try {
    const local = await context.prisma.video.findUnique({
      where: { id: videoId },
    });
    if (local === null) return videoNotFound();
    const localProviderVideoId = providerVideoIdSchema.parse(
      local.providerVideoId,
    );
    const reconciliationCutoff = context.now();
    if (local.state === "deleted") {
      await markPendingWebhooksReconciled(
        context.prisma,
        localProviderVideoId,
        reconciliationCutoff,
        context.now(),
      );
      return { ok: true, value: toDto(local) };
    }
    const remote = await context.provider.find({
      id: localProviderVideoId,
      projectId: local.projectId,
    });
    if (
      remote === null ||
      remote.id !== local.providerVideoId ||
      remote.projectId !== local.projectId
    )
      return providerMismatch();
    const lifecycle = providerLifecycle(remote);
    const deleting = isVideoDeletionState(local.state);
    const syncedAt = context.now();
    const updated = await context.prisma.$transaction(async (transaction) => {
      const video = await transaction.video.update({
        where: { id: videoId },
        data: {
          failureCode: deleting ? local.failureCode : lifecycle.failureCode,
          durationSeconds: remote.durationSeconds ?? null,
          lastSyncedAt: syncedAt,
          providerEmbedLocator: lifecycle.embedLocator,
          providerMessage: remote.message ?? null,
          providerStatus: remote.status,
          providerVisibleAt: syncedAt,
          readyAt: deleting
            ? local.readyAt
            : lifecycle.state === "ready"
              ? (local.readyAt ?? syncedAt)
              : null,
          state: deleting ? local.state : lifecycle.state,
          title: remote.title,
          updatedAt: syncedAt,
        },
      });
      await markPendingWebhooksReconciled(
        transaction,
        localProviderVideoId,
        reconciliationCutoff,
        context.now(),
      );
      return video;
    });
    return { ok: true, value: toDto(updated) };
  } catch (error) {
    return dependencyFailure(
      { module: "videos", operation: "reconcileById" },
      error,
      dependencyUnavailable(),
    );
  }
}
