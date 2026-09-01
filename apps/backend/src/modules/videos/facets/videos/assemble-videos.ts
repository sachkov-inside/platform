import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { VideosPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { VideoProvider, ProviderVideo } from "../../ports/video-provider.js";
import type {
  VideoDto,
  VideoResult,
  Videos,
  VideoState,
} from "./videos.interface.js";

const uuid = z.uuid();
const access = z.enum(["free", "membership"]);
const initInput = z.object({
  access,
  actor: uuid,
  byteSize: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
  filename: z.string().trim().min(1).max(255),
  idempotencyKey: z.string().trim().min(1).max(128),
  materialId: uuid,
  title: z.string().trim().min(1).max(255),
}).strict();
const attachInput = z.object({
  access,
  actor: uuid,
  materialId: uuid,
  providerVideoId: z.string().trim().min(1).max(256),
}).strict();
const reconcileInput = z.object({ actor: uuid, videoId: uuid }).strict();

export function assembleVideos(dependencies: {
  readonly canManage: (accountId: string) => Promise<boolean>;
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
      const existing = await dependencies.prisma.videoUploadAttempt.findFirst({
        where: {
          createdBy: parsed.data.actor,
          idempotencyKey: parsed.data.idempotencyKey,
          materialId: parsed.data.materialId,
        },
      });
      if (existing !== null) {
        const video = await dependencies.prisma.video.findUnique({ where: { id: existing.videoId } });
        if (
          video === null ||
          video.access !== parsed.data.access ||
          video.originalFilename !== parsed.data.filename ||
          video.title !== parsed.data.title ||
          Number(existing.byteSize) !== parsed.data.byteSize
        ) {
          return { ok: false, error: { code: "idempotency_key_reused" } };
        }
        return { ok: true, value: { uploadEndpoint: existing.uploadEndpoint, video: toDto(video) } };
      }
      const projectId = dependencies.projects[parsed.data.access];
      try {
        const initialized = await dependencies.provider.initUpload({
          ...parsed.data,
          projectId,
        });
        const videoId = randomUUID();
        const createdAt = now();
        const video = await dependencies.prisma.$transaction(async (transaction) => {
          const saved = await transaction.video.create({
            data: {
              id: videoId,
              access: parsed.data.access,
              createdAt,
              createdBy: parsed.data.actor,
              materialId: parsed.data.materialId,
              originalFilename: parsed.data.filename,
              projectId,
              providerStatus: "uploading",
              providerVideoId: initialized.id,
              state: "uploading",
              title: parsed.data.title,
              updatedAt: createdAt,
            },
          });
          await transaction.videoUploadAttempt.create({
            data: {
              id: randomUUID(),
              byteSize: BigInt(parsed.data.byteSize),
              createdAt,
              createdBy: parsed.data.actor,
              filename: parsed.data.filename,
              idempotencyKey: parsed.data.idempotencyKey,
              materialId: parsed.data.materialId,
              uploadEndpoint: initialized.uploadEndpoint,
              videoId,
            },
          });
          return saved;
        });
        return { ok: true, value: { uploadEndpoint: initialized.uploadEndpoint, video: toDto(video) } };
      } catch {
        return dependencyUnavailable();
      }
    },

    async attachExisting(input) {
      const parsed = attachInput.safeParse(input);
      if (!parsed.success) return invalidRequest();
      if (!(await managerAllowed(parsed.data.actor))) return forbidden();
      const projectId = dependencies.projects[parsed.data.access];
      try {
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
          return duplicate.materialId === parsed.data.materialId && duplicate.access === parsed.data.access
            ? { ok: true, value: toDto(duplicate) }
            : providerMismatch();
        }
        const lifecycle = providerLifecycle(remote);
        const savedAt = now();
        const saved = await dependencies.prisma.video.create({
          data: {
            id: randomUUID(),
            access: parsed.data.access,
            createdAt: savedAt,
            createdBy: parsed.data.actor,
            failureCode: lifecycle.failureCode,
            lastSyncedAt: savedAt,
            materialId: parsed.data.materialId,
            projectId,
            providerEmbedLocator: lifecycle.embedLocator,
            providerMessage: remote.message ?? null,
            providerStatus: remote.status,
            providerVideoId: remote.id,
            readyAt: lifecycle.state === "ready" ? savedAt : null,
            state: lifecycle.state,
            title: remote.title,
            updatedAt: savedAt,
          },
        });
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

    async acceptWebhook(input) {
      try {
        const receivedAt = now();
        const inbox = await dependencies.prisma.videoWebhookInbox.create({
          data: {
            id: randomUUID(),
            event: input.event.slice(0, 128),
            providerStatus: input.providerStatus?.slice(0, 64) ?? null,
            providerVideoId: input.providerVideoId.slice(0, 256),
            receivedAt,
          },
        });
        const local = await dependencies.prisma.video.findFirst({
          where: { providerVideoId: input.providerVideoId },
        });
        if (local !== null) {
          const reconciled = await reconcileById(local.id);
          if (!reconciled.ok) return reconciled;
        }
        await dependencies.prisma.videoWebhookInbox.update({
          where: { id: inbox.id },
          data: { reconciledAt: now() },
        });
        return { ok: true, value: undefined };
      } catch {
        return dependencyUnavailable();
      }
    },

    async inspectPrimaryReference(input) {
      if (!uuid.safeParse(input.videoId).success || !uuid.safeParse(input.materialId).success || !access.safeParse(input.access).success) {
        return invalidRequest();
      }
      try {
        const video = await dependencies.prisma.video.findUnique({ where: { id: input.videoId } });
        if (video === null) return videoNotFound();
        if (video.materialId !== input.materialId || video.access !== input.access || video.projectId !== dependencies.projects[input.access]) {
          return providerMismatch();
        }
        return video.state === "ready" ? { ok: true, value: undefined } : videoNotReady();
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadPresentation(input) {
      try {
        const video = await dependencies.prisma.video.findFirst({
          where: { id: input.videoId, materialId: input.materialId },
        });
        return {
          ok: true,
          value: video === null
            ? null
            : {
                videoId: video.id,
                title: video.title,
                state: state(video.state),
                ...(video.failureCode === null ? {} : { failureCode: video.failureCode }),
              },
        };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadAccessFacts(videoIds) {
      try {
        const videos = await dependencies.prisma.video.findMany({ where: { id: { in: [...videoIds] } } });
        return { ok: true, value: videos.map((video) => ({
          access: access.parse(video.access),
          materialId: video.materialId,
          videoId: video.id,
        })) };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadPlayback(videoId) {
      try {
        const video = await dependencies.prisma.video.findUnique({ where: { id: videoId } });
        if (video === null) return { ok: true, value: null };
        if (video.state !== "ready" || video.providerEmbedLocator === null) return videoNotReady();
        return { ok: true, value: {
          access: access.parse(video.access),
          embedLocator: video.providerEmbedLocator,
          materialId: video.materialId,
          providerVideoId: video.providerVideoId,
          videoId: video.id,
        } };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadProgress(input) {
      try {
        const progress = await dependencies.prisma.videoPlaybackProgress.findUnique({
          where: { accountId_videoId: { accountId: input.accountId, videoId: input.videoId } },
        });
        return { ok: true, value: progress === null ? null : { positionSeconds: progress.positionSeconds } };
      } catch {
        return dependencyUnavailable();
      }
    },

    async saveProgress(input) {
      if (!uuid.safeParse(input.accountId).success || !uuid.safeParse(input.videoId).success || !Number.isInteger(input.durationSeconds) || !Number.isInteger(input.positionSeconds) || input.durationSeconds <= 0 || input.positionSeconds < 0 || input.positionSeconds > input.durationSeconds) {
        return invalidRequest();
      }
      try {
        await dependencies.prisma.videoPlaybackProgress.upsert({
          where: { accountId_videoId: { accountId: input.accountId, videoId: input.videoId } },
          create: { ...input, updatedAt: now() },
          update: { durationSeconds: input.durationSeconds, positionSeconds: input.positionSeconds, updatedAt: now() },
        });
        return { ok: true, value: undefined };
      } catch {
        return dependencyUnavailable();
      }
    },
  };
  return Object.freeze(videos);

  async function managerAllowed(actor: string): Promise<boolean> {
    try {
      return await dependencies.canManage(actor);
    } catch {
      return false;
    }
  }

  async function reconcileById(videoId: string): Promise<VideoResult<VideoDto>> {
    try {
      const local = await dependencies.prisma.video.findUnique({ where: { id: videoId } });
      if (local === null) return videoNotFound();
      const remote = await dependencies.provider.find({ id: local.providerVideoId, projectId: local.projectId });
      if (
        remote === null ||
        remote.id !== local.providerVideoId ||
        remote.projectId !== local.projectId
      ) return providerMismatch();
      const lifecycle = providerLifecycle(remote);
      const syncedAt = now();
      const updated = await dependencies.prisma.video.update({
        where: { id: local.id },
        data: {
          failureCode: lifecycle.failureCode,
          lastSyncedAt: syncedAt,
          providerEmbedLocator: lifecycle.embedLocator,
          providerMessage: remote.message ?? null,
          providerStatus: remote.status,
          readyAt: lifecycle.state === "ready" ? local.readyAt ?? syncedAt : null,
          state: lifecycle.state,
          title: remote.title,
          updatedAt: syncedAt,
        },
      });
      return { ok: true, value: toDto(updated) };
    } catch {
      return dependencyUnavailable();
    }
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

function toDto(video: { id: string; access: string; materialId: string; state: string; title: string; failureCode: string | null }): VideoDto {
  return {
    access: access.parse(video.access),
    materialId: video.materialId,
    state: state(video.state),
    title: video.title,
    videoId: video.id,
    ...(video.failureCode === null ? {} : { failureCode: video.failureCode }),
  };
}

function state(value: string): VideoState {
  return z.enum(["uploading", "processing", "ready", "failed"]).parse(value);
}

const invalidRequest = <Value>(): VideoResult<Value> => ({ ok: false, error: { code: "invalid_request" } });
const forbidden = <Value>(): VideoResult<Value> => ({ ok: false, error: { code: "forbidden" } });
const dependencyUnavailable = <Value>(): VideoResult<Value> => ({ ok: false, error: { code: "dependency_unavailable", retryable: true } });
const providerMismatch = <Value>(): VideoResult<Value> => ({ ok: false, error: { code: "provider_mismatch" } });
const videoNotFound = <Value>(): VideoResult<Value> => ({ ok: false, error: { code: "video_not_found" } });
const videoNotReady = <Value>(): VideoResult<Value> => ({ ok: false, error: { code: "video_not_ready" } });
