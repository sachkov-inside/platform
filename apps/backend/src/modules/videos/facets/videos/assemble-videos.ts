import { z } from "zod";

import type { VideosPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  newVideoId,
  newVideoUploadAttemptId,
  newVideoWebhookInboxId,
  providerVideoIdSchema,
  videoAccountIdSchema,
  videoIdempotencyKeySchema,
  videoIdSchema,
  videoMaterialIdSchema,
  type ProviderVideoId,
  type VideoAccountId,
  type VideoId,
  type VideoUploadAttemptId,
} from "../../domain/video-identifiers.js";
import type { VideoProvider, ProviderVideo } from "../../ports/video-provider.js";
import type {
  InitVideoUploadResult,
  VideoDto,
  VideoError,
  VideoResult,
  Videos,
  VideoState,
} from "./videos.interface.js";

const access = z.enum(["free", "membership"]);
const initInput = z.object({
  access,
  actor: videoAccountIdSchema,
  byteSize: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
  filename: z.string().trim().min(1).max(255),
  idempotencyKey: videoIdempotencyKeySchema,
  materialId: videoMaterialIdSchema,
  title: z.string().trim().min(1).max(255),
}).strict();
const attachInput = z.object({
  access,
  actor: videoAccountIdSchema,
  materialId: videoMaterialIdSchema,
  providerVideoId: providerVideoIdSchema,
}).strict();
const reconcileInput = z.object({ actor: videoAccountIdSchema, videoId: videoIdSchema }).strict();
const retryDeletionInput = reconcileInput;
const webhookInput = z.object({
  event: z.string().trim().min(1).max(128),
  providerStatus: z.string().trim().min(1).max(64).optional(),
  providerVideoId: providerVideoIdSchema,
}).strict();
const primaryReferenceInput = z.object({
  access,
  materialId: videoMaterialIdSchema,
  videoId: videoIdSchema,
}).strict();
const presentationInput = z.object({
  materialId: videoMaterialIdSchema,
  videoId: videoIdSchema,
}).strict();
const progressIdentityInput = z.object({
  accountId: videoAccountIdSchema,
  videoId: videoIdSchema,
}).strict();
const saveProgressInput = progressIdentityInput.extend({
  durationSeconds: z.number().int().positive(),
  positionSeconds: z.number().int().nonnegative(),
}).refine((value) => value.positionSeconds <= value.durationSeconds);

export function assembleVideos(dependencies: {
  readonly canManage: (accountId: VideoAccountId) => Promise<boolean>;
  readonly prisma: VideosPrismaClient;
  readonly provider: VideoProvider;
  readonly projects: Readonly<Record<"free" | "membership", string>>;
  readonly clock?: () => Date;
}): Videos {
  const now = dependencies.clock ?? (() => new Date());

  const videos: Videos = {
    async initUpload(input) {
      const parsed = initInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      if (!(await managerAllowed(parsed.data.actor))) return forbidden();
      const projectId = dependencies.projects[parsed.data.access];
      const attempts = await Promise.all([
        dependencies.prisma.videoUploadAttempt.findFirst({
          where: {
            createdBy: parsed.data.actor,
            idempotencyKey: parsed.data.idempotencyKey,
            materialId: parsed.data.materialId,
          },
        }),
        dependencies.prisma.videoUploadAttempt.findFirst({
          where: {
            createdBy: parsed.data.actor,
            materialId: parsed.data.materialId,
            status: { in: ["initializing", "unknown"] },
          },
        }),
      ]).catch(() => null);
      if (attempts === null) return dependencyUnavailable();
      const [existing, unresolved] = attempts;
      if (existing !== null) {
        return replayUploadAttempt(existing, parsed.data, projectId);
      }
      if (unresolved !== null) return uploadOutcomeUnknown();
      const attemptId = newVideoUploadAttemptId();
      const createdAt = now();
      try {
        await dependencies.prisma.videoUploadAttempt.create({
          data: {
            access: parsed.data.access,
            byteSize: BigInt(parsed.data.byteSize),
            createdAt,
            createdBy: parsed.data.actor,
            filename: parsed.data.filename,
            id: attemptId,
            idempotencyKey: parsed.data.idempotencyKey,
            materialId: parsed.data.materialId,
            projectId,
            status: "initializing",
            title: parsed.data.title,
            updatedAt: createdAt,
          },
        });
      } catch {
        const concurrent = await dependencies.prisma.videoUploadAttempt.findFirst({
          where: {
            createdBy: parsed.data.actor,
            idempotencyKey: parsed.data.idempotencyKey,
            materialId: parsed.data.materialId,
          },
        }).catch(() => null);
        if (concurrent !== null) return replayUploadAttempt(concurrent, parsed.data, projectId);
        const concurrentUnresolved = await dependencies.prisma.videoUploadAttempt.findFirst({
          where: {
            createdBy: parsed.data.actor,
            materialId: parsed.data.materialId,
            status: { in: ["initializing", "unknown"] },
          },
        }).catch(() => null);
        return concurrentUnresolved === null ? dependencyUnavailable() : uploadOutcomeUnknown();
      }
      let initialized: Awaited<ReturnType<VideoProvider["initUpload"]>>;
      try {
        initialized = await dependencies.provider.initUpload({
          ...parsed.data,
          projectId,
        });
      } catch {
        await markUploadOutcomeUnknown(attemptId);
        return dependencyUnavailable();
      }
      const initializedProviderVideoId = providerVideoIdSchema.safeParse(initialized.id);
      if (!initializedProviderVideoId.success) {
        await markUploadOutcomeUnknown(attemptId);
        return dependencyUnavailable();
      }
      try {
        const videoId = newVideoId();
        const video = await dependencies.prisma.$transaction(async (transaction) => {
          const saved = await transaction.video.create({
            data: {
              id: videoId,
              access: parsed.data.access,
              createdAt,
              createdBy: parsed.data.actor,
              materialId: parsed.data.materialId,
              originalFilename: parsed.data.filename,
              origin: "platform_upload",
              projectId,
              providerStatus: "uploading",
              providerVisibleAt: createdAt,
              providerVideoId: initializedProviderVideoId.data,
              state: "uploading",
              title: parsed.data.title,
              updatedAt: createdAt,
            },
          });
          await transaction.videoUploadAttempt.update({
            where: { id: attemptId },
            data: {
              status: "ready",
              uploadEndpoint: initialized.uploadEndpoint,
              updatedAt: now(),
              videoId,
            },
          });
          return saved;
        });
        if (!(await reconcilePendingWebhooks(
          initializedProviderVideoId.data,
          videoIdSchema.parse(video.id),
        ))) return dependencyUnavailable();
        return { ok: true, value: { uploadEndpoint: initialized.uploadEndpoint, video: toDto(video) } };
      } catch {
        await markUploadOutcomeUnknown(attemptId);
        return dependencyUnavailable();
      }
    },

    async attachExisting(input) {
      const parsed = attachInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      if (!(await managerAllowed(parsed.data.actor))) return forbidden();
      const projectId = dependencies.projects[parsed.data.access];
      try {
        const reconciliationCutoff = now();
        const remote = await dependencies.provider.find({ id: parsed.data.providerVideoId, projectId });
        if (
          remote === null ||
          remote.id !== parsed.data.providerVideoId ||
          remote.projectId !== projectId
        ) return providerMismatch();
        const duplicate = await dependencies.prisma.video.findFirst({
          where: { providerVideoId: remote.id, projectId },
        });
        if (duplicate !== null) {
          if (duplicate.materialId !== parsed.data.materialId || duplicate.access !== parsed.data.access) {
            return providerMismatch();
          }
          if (!(await reconcilePendingWebhooks(
            providerVideoIdSchema.parse(duplicate.providerVideoId),
            videoIdSchema.parse(duplicate.id),
          ))) return dependencyUnavailable();
          return { ok: true, value: toDto(duplicate) };
        }
        const lifecycle = providerLifecycle(remote);
        const savedAt = now();
        const saved = await dependencies.prisma.$transaction(async (transaction) => {
          const video = await transaction.video.create({
            data: {
              id: newVideoId(),
              access: parsed.data.access,
              createdAt: savedAt,
              createdBy: parsed.data.actor,
              failureCode: lifecycle.failureCode,
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
          );
          return video;
        });
        if (!(await reconcilePendingWebhooks(
          parsed.data.providerVideoId,
          videoIdSchema.parse(saved.id),
        ))) return dependencyUnavailable();
        return { ok: true, value: toDto(saved) };
      } catch {
        return dependencyUnavailable();
      }
    },

    async reconcile(input) {
      const parsed = reconcileInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      if (!(await managerAllowed(parsed.data.actor))) return forbidden();
      return reconcileById(parsed.data.videoId);
    },

    async retryDeletion(input) {
      const parsed = retryDeletionInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      if (!(await managerAllowed(parsed.data.actor))) return forbidden();
      try {
        const retriedAt = now();
        return await dependencies.prisma.$transaction(async (transaction) => {
          const video = await transaction.video.findUnique({
            include: { deletionOperation: true },
            where: { id: parsed.data.videoId },
          });
          if (video === null) return videoNotFound();
          if (
            video.origin !== "platform_upload" ||
            video.state !== "delete_failed" ||
            video.deletionOperation?.state !== "delete_failed"
          ) return videoDeletionNotRetryable();
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
      } catch {
        return dependencyUnavailable();
      }
    },

    async acceptWebhook(input) {
      const parsed = webhookInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      try {
        const receivedAt = now();
        await dependencies.prisma.videoWebhookInbox.create({
          data: {
            id: newVideoWebhookInboxId(),
            event: parsed.data.event,
            providerStatus: parsed.data.providerStatus ?? null,
            providerVideoId: parsed.data.providerVideoId,
            receivedAt,
          },
        });
        const local = await dependencies.prisma.video.findFirst({
          where: { providerVideoId: parsed.data.providerVideoId },
        });
        if (local === null) return { ok: true, value: undefined };
        const reconciled = await reconcileById(videoIdSchema.parse(local.id));
        if (!reconciled.ok) return reconciled;
        return { ok: true, value: undefined };
      } catch {
        return dependencyUnavailable();
      }
    },

    async inspectPrimaryReference(input) {
      const parsed = primaryReferenceInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      try {
        const video = await dependencies.prisma.video.findUnique({ where: { id: parsed.data.videoId } });
        if (video === null) return videoNotFound();
        if (videoMaterialIdSchema.parse(video.materialId) !== parsed.data.materialId || video.access !== parsed.data.access || video.projectId !== dependencies.projects[parsed.data.access]) {
          return providerMismatch();
        }
        return video.state === "ready" ? { ok: true, value: undefined } : videoNotReady();
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadPresentation(input) {
      const parsed = presentationInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      try {
        const video = await dependencies.prisma.video.findFirst({
          where: { id: parsed.data.videoId, materialId: parsed.data.materialId },
        });
        return {
          ok: true,
          value: video === null
            ? null
            : {
                videoId: videoIdSchema.parse(video.id),
                title: video.title,
                state: parseVideoState(video.state),
                ...(video.failureCode === null ? {} : { failureCode: video.failureCode }),
              },
        };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadAuthoringPresentation(input) {
      const parsed = presentationInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      try {
        const video = await dependencies.prisma.video.findFirst({
          where: { id: parsed.data.videoId, materialId: parsed.data.materialId },
        });
        return {
          ok: true,
          value: video === null ? null : toAuthoringPresentation(video),
        };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadLatestDeletion(materialId) {
      const parsed = videoMaterialIdSchema.safeParse(materialId);
      if (!parsed.success) return invalidRequest();
      try {
        const video = await dependencies.prisma.video.findFirst({
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
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadAccessFacts(videoIds) {
      const parsed = z.array(videoIdSchema).safeParse(videoIds);
      if (!parsed.success) return invalidRequest();
      try {
        const videos = await dependencies.prisma.video.findMany({ where: { id: { in: parsed.data } } });
        return { ok: true, value: videos.map((video) => ({
          access: access.parse(video.access),
          materialId: videoMaterialIdSchema.parse(video.materialId),
          videoId: videoIdSchema.parse(video.id),
        })) };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadPlayback(videoId) {
      const parsed = videoIdSchema.safeParse(videoId);
      if (!parsed.success) return invalidRequest();
      try {
        const video = await dependencies.prisma.video.findUnique({ where: { id: parsed.data } });
        if (video === null) return { ok: true, value: null };
        if (video.state !== "ready" || video.providerEmbedLocator === null) return videoNotReady();
        return { ok: true, value: {
          access: access.parse(video.access),
          embedLocator: video.providerEmbedLocator,
          materialId: videoMaterialIdSchema.parse(video.materialId),
          providerVideoId: providerVideoIdSchema.parse(video.providerVideoId),
          videoId: videoIdSchema.parse(video.id),
        } };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadProgress(input) {
      const parsed = progressIdentityInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      try {
        const progress = await dependencies.prisma.videoPlaybackProgress.findUnique({
          where: { accountId_videoId: parsed.data },
        });
        return { ok: true, value: progress === null ? null : { positionSeconds: progress.positionSeconds } };
      } catch {
        return dependencyUnavailable();
      }
    },

    async saveProgress(input) {
      const parsed = saveProgressInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      try {
        const video = await dependencies.prisma.video.findUnique({
          select: { state: true },
          where: { id: parsed.data.videoId },
        });
        if (video === null || isDeletionState(video.state)) return videoNotReady();
        await dependencies.prisma.videoPlaybackProgress.upsert({
          where: { accountId_videoId: { accountId: parsed.data.accountId, videoId: parsed.data.videoId } },
          create: { ...parsed.data, updatedAt: now() },
          update: { durationSeconds: parsed.data.durationSeconds, positionSeconds: parsed.data.positionSeconds, updatedAt: now() },
        });
        return { ok: true, value: undefined };
      } catch {
        return dependencyUnavailable();
      }
    },
  };
  return Object.freeze(videos);

  async function managerAllowed(actor: VideoAccountId): Promise<boolean> {
    try {
      return await dependencies.canManage(actor);
    } catch {
      return false;
    }
  }

  async function replayUploadAttempt(
    attempt: {
      readonly access: string;
      readonly byteSize: bigint;
      readonly filename: string;
      readonly projectId: string;
      readonly status: string;
      readonly title: string;
      readonly uploadEndpoint: string | null;
      readonly videoId: string | null;
    },
    input: z.output<typeof initInput>,
    projectId: string,
  ): Promise<InitVideoUploadResult> {
    if (
      attempt.access !== input.access ||
      attempt.filename !== input.filename ||
      attempt.projectId !== projectId ||
      attempt.title !== input.title ||
      Number(attempt.byteSize) !== input.byteSize
    ) return { ok: false, error: { code: "idempotency_key_reused" } };
    if (attempt.status !== "ready" || attempt.videoId === null || attempt.uploadEndpoint === null) {
      return uploadOutcomeUnknown();
    }
    try {
      const video = await dependencies.prisma.video.findUnique({
        where: { id: videoIdSchema.parse(attempt.videoId) },
      });
      if (video === null) return uploadOutcomeUnknown();
      if (!(await reconcilePendingWebhooks(
        providerVideoIdSchema.parse(video.providerVideoId),
        videoIdSchema.parse(video.id),
      ))) return dependencyUnavailable();
      return { ok: true, value: { uploadEndpoint: attempt.uploadEndpoint, video: toDto(video) } };
    } catch {
      return dependencyUnavailable();
    }
  }

  async function markUploadOutcomeUnknown(attemptId: VideoUploadAttemptId): Promise<void> {
    await dependencies.prisma.videoUploadAttempt.update({
      where: { id: attemptId },
      data: {
        failureCode: "provider_outcome_unknown",
        status: "unknown",
        updatedAt: now(),
      },
    }).catch(() => undefined);
  }

  async function reconcilePendingWebhooks(providerVideoId: ProviderVideoId, videoId: VideoId): Promise<boolean> {
    const cutoff = now();
    try {
      const pending = await dependencies.prisma.videoWebhookInbox.findFirst({
        where: { providerVideoId, reconciledAt: null, receivedAt: { lte: cutoff } },
      });
      if (pending === null) return true;
      const reconciled = await reconcileById(videoId);
      return reconciled.ok;
    } catch {
      // The durable inbox stays pending for the next browser poll or provider retry.
      return false;
    }
  }

  async function reconcileById(videoId: VideoId): Promise<VideoResult<
    VideoDto,
    Extract<VideoError, { readonly code: "dependency_unavailable" | "provider_mismatch" | "video_not_found" }>
  >> {
    try {
      const local = await dependencies.prisma.video.findUnique({ where: { id: videoId } });
      if (local === null) return videoNotFound();
      const localProviderVideoId = providerVideoIdSchema.parse(local.providerVideoId);
      const reconciliationCutoff = now();
      if (local.state === "deleted") {
        await markPendingWebhooksReconciled(
          dependencies.prisma,
          localProviderVideoId,
          reconciliationCutoff,
        );
        return { ok: true, value: toDto(local) };
      }
      const remote = await dependencies.provider.find({ id: localProviderVideoId, projectId: local.projectId });
      if (
        remote === null ||
        remote.id !== local.providerVideoId ||
        remote.projectId !== local.projectId
      ) return providerMismatch();
      const lifecycle = providerLifecycle(remote);
      const deleting = isDeletionState(local.state);
      const syncedAt = now();
      const updated = await dependencies.prisma.$transaction(async (transaction) => {
        const video = await transaction.video.update({
          where: { id: videoId },
          data: {
            failureCode: deleting ? local.failureCode : lifecycle.failureCode,
            lastSyncedAt: syncedAt,
            providerEmbedLocator: lifecycle.embedLocator,
            providerMessage: remote.message ?? null,
            providerStatus: remote.status,
            providerVisibleAt: syncedAt,
            readyAt: deleting
              ? local.readyAt
              : lifecycle.state === "ready" ? local.readyAt ?? syncedAt : null,
            state: deleting ? local.state : lifecycle.state,
            title: remote.title,
            updatedAt: syncedAt,
          },
        });
        await markPendingWebhooksReconciled(
          transaction,
          localProviderVideoId,
          reconciliationCutoff,
        );
        return video;
      });
      return { ok: true, value: toDto(updated) };
    } catch {
      return dependencyUnavailable();
    }
  }

  async function markPendingWebhooksReconciled(
    transaction: Pick<VideosPrismaClient, "videoWebhookInbox">,
    providerVideoId: ProviderVideoId,
    cutoff: Date,
  ): Promise<void> {
    await transaction.videoWebhookInbox.updateMany({
      where: { providerVideoId, reconciledAt: null, receivedAt: { lte: cutoff } },
      data: { reconciledAt: now() },
    });
  }
}

function providerLifecycle(remote: ProviderVideo): {
  readonly embedLocator: string | null;
  readonly failureCode: string | null;
  readonly state: VideoState;
} {
  if (remote.status === "done") {
    return remote.embedLocator === null
      ? { embedLocator: null, failureCode: "missing_embed_locator", state: "failed" }
      : { embedLocator: remote.embedLocator, failureCode: null, state: "ready" };
  }
  if (remote.status === "pending" || remote.status === "uploading") {
    return { embedLocator: null, failureCode: null, state: "uploading" };
  }
  if (["pre-processing", "processing", "suspended"].includes(remote.status)) {
    return { embedLocator: null, failureCode: null, state: "processing" };
  }
  if (["aborted", "error"].includes(remote.status)) {
    return { embedLocator: null, failureCode: `provider_${remote.status}`, state: "failed" };
  }
  return { embedLocator: null, failureCode: "unknown_provider_status", state: "failed" };
}

function toDto(video: { id: string; access: string; materialId: string; origin: string; state: string; title: string; failureCode: string | null }): VideoDto {
  return {
    access: access.parse(video.access),
    materialId: videoMaterialIdSchema.parse(video.materialId),
    origin: z.enum(["external_attachment", "platform_upload"]).parse(video.origin),
    state: parseVideoState(video.state),
    title: video.title,
    videoId: videoIdSchema.parse(video.id),
    ...(video.failureCode === null ? {} : { failureCode: video.failureCode }),
  };
}

function toAuthoringPresentation(video: {
  readonly failureCode: string | null;
  readonly id: string;
  readonly origin: string;
  readonly state: string;
  readonly title: string;
}) {
  return {
    origin: z.enum(["external_attachment", "platform_upload"]).parse(video.origin),
    state: parseVideoState(video.state),
    title: video.title,
    videoId: videoIdSchema.parse(video.id),
    ...(video.failureCode === null ? {} : { failureCode: video.failureCode }),
  };
}

function parseVideoState(value: string): VideoState {
  return z.enum([
    "uploading",
    "processing",
    "ready",
    "failed",
    "deletion_requested",
    "deleting",
    "deleted",
    "delete_failed",
  ]).parse(value);
}

function isDeletionState(value: string): boolean {
  return value === "deletion_requested" ||
    value === "deleting" ||
    value === "deleted" ||
    value === "delete_failed";
}

type VideoFailure<Code extends VideoError["code"]> = Readonly<{
  ok: false;
  error: Extract<VideoError, { readonly code: Code }>;
}>;

const invalidRequest = (): VideoFailure<"invalid_request"> => ({ ok: false, error: { code: "invalid_request" } });
const forbidden = (): VideoFailure<"forbidden"> => ({ ok: false, error: { code: "forbidden" } });
const dependencyUnavailable = (): VideoFailure<"dependency_unavailable"> => ({ ok: false, error: { code: "dependency_unavailable", retryable: true } });
const providerMismatch = (): VideoFailure<"provider_mismatch"> => ({ ok: false, error: { code: "provider_mismatch" } });
const uploadOutcomeUnknown = (): VideoFailure<"upload_outcome_unknown"> => ({ ok: false, error: { code: "upload_outcome_unknown" } });
const videoDeletionNotRetryable = (): VideoFailure<"video_deletion_not_retryable"> => ({ ok: false, error: { code: "video_deletion_not_retryable" } });
const videoNotFound = (): VideoFailure<"video_not_found"> => ({ ok: false, error: { code: "video_not_found" } });
const videoNotReady = (): VideoFailure<"video_not_ready"> => ({ ok: false, error: { code: "video_not_ready" } });
