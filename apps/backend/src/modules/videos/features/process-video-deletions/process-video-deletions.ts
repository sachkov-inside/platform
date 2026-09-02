import { z } from "zod";

import {
  Prisma,
  type VideosPrisma,
  type VideosPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { VideoProvider } from "../../ports/video-provider.js";

const VIDEO_DELETION_RETRY_ATTEMPT_LIMIT = 5;
const VIDEO_DELETION_CLAIM_TIMEOUT_MILLISECONDS = 300_000;
const VIDEO_DELETION_RETRY_INITIAL_DELAY_MILLISECONDS = 30_000;
const VIDEO_DELETION_RETRY_MAX_DELAY_MILLISECONDS = 300_000;
const VIDEO_DELETION_RETRY_JITTER_RATIO = 0.2;
const VIDEO_DELETION_BATCH_SIZE = 25;

export const VIDEO_DELETION_MAINTENANCE = Symbol("VIDEO_DELETION_MAINTENANCE");

type DeletionSummary = Readonly<{
  deferred: number;
  deleted: number;
  failed: number;
  retried: number;
}>;

export interface VideoDeletionMaintenance {
  process(input: {
    readonly isReferenced: (input: {
      readonly materialId: string;
      readonly videoId: string;
    }) => Promise<boolean>;
  }): Promise<
    | Readonly<{ ok: true; value: DeletionSummary }>
    | Readonly<{
        ok: false;
        error: { readonly code: "dependency_unavailable"; readonly retryable: true };
      }>
  >;
}

export function assembleVideoDeletionMaintenance(dependencies: {
  readonly prisma: VideosPrismaClient;
  readonly provider: Pick<VideoProvider, "delete" | "find">;
  readonly clock?: () => Date;
  readonly random?: () => number;
  readonly reportFailure?: (event: {
    readonly category: string;
    readonly operationId: string;
    readonly providerRequestId?: string;
  }) => void;
}): VideoDeletionMaintenance {
  const now = dependencies.clock ?? (() => new Date());
  const random = dependencies.random ?? Math.random;

  const maintenance: VideoDeletionMaintenance = {
    async process(input) {
      const summary = { deferred: 0, deleted: 0, failed: 0, retried: 0 };
      try {
        const claimCutoff = new Date(
          now().getTime() - VIDEO_DELETION_CLAIM_TIMEOUT_MILLISECONDS,
        );
        const candidates = await dependencies.prisma.videoDeletionOperation.findMany({
          orderBy: { requestedAt: "asc" },
          take: VIDEO_DELETION_BATCH_SIZE,
          where: {
            OR: [
              { state: "deletion_requested", nextAttemptAt: { lte: now() } },
              { state: "deleting", claimedAt: { lte: claimCutoff } },
            ],
          },
        });
        for (const candidate of candidates) {
          const claim = await claimDeletion(candidate.id, input.isReferenced);
          if (claim === null) continue;
          if (claim.kind === "deferred") {
            summary.deferred += 1;
            await reconcileActiveProviderState(claim);
            continue;
          }
          if (claim.kind === "failed") {
            summary.failed += 1;
            dependencies.reportFailure?.({
              category: claim.category,
              operationId: claim.operationId,
            });
            continue;
          }
          const outcome = await dependencies.provider.delete({ id: claim.providerVideoId });
          if (
            outcome.kind === "deleted" ||
            (outcome.kind === "not_found" &&
              claim.origin === "platform_upload" &&
              claim.providerVisibleAt !== null)
          ) {
            if (await completeDeletion(claim, outcome.providerRequestId)) {
              summary.deleted += 1;
            }
            continue;
          }
          if (
            outcome.kind === "retryable_failure" &&
            claim.cycleAttempts < VIDEO_DELETION_RETRY_ATTEMPT_LIMIT
          ) {
            if (await scheduleRetry(claim, outcome.category, outcome.providerRequestId)) {
              summary.retried += 1;
            }
            continue;
          }
          const category = outcome.kind === "not_found"
            ? "provider_not_found_unverified"
            : outcome.kind === "retryable_failure"
              ? "retry_exhausted"
              : outcome.category;
          if (await failDeletion(claim, category, outcome.providerRequestId)) {
            dependencies.reportFailure?.({
              category,
              operationId: claim.operationId,
              ...(outcome.providerRequestId === undefined
                ? {}
                : { providerRequestId: outcome.providerRequestId }),
            });
            summary.failed += 1;
          }
        }
        return { ok: true, value: summary };
      } catch {
        return {
          error: { code: "dependency_unavailable", retryable: true },
          ok: false,
        };
      }
    },
  };
  return Object.freeze(maintenance);

  async function claimDeletion(
    operationId: string,
    isReferenced: Parameters<VideoDeletionMaintenance["process"]>[0]["isReferenced"],
  ): Promise<
    | DeletionClaim
    | DeferredDeletion
    | Readonly<{ category: string; kind: "failed"; operationId: string }>
    | null
  > {
    return dependencies.prisma.$transaction(async (transaction) => {
      const initial = await transaction.videoDeletionOperation.findUnique({
        where: { id: operationId },
      });
      if (initial === null) return null;
      await transaction.$executeRaw(Prisma.sql`
        select pg_advisory_xact_lock(hashtextextended(${initial.materialId}, 0))
      `);
      const operation = await transaction.videoDeletionOperation.findUnique({
        include: { video: true },
        where: { id: operationId },
      });
      const claimCutoff = new Date(
        now().getTime() - VIDEO_DELETION_CLAIM_TIMEOUT_MILLISECONDS,
      );
      if (
        operation === null ||
        !(
          (operation.state === "deletion_requested" && operation.nextAttemptAt <= now()) ||
          (operation.state === "deleting" &&
            operation.claimedAt !== null &&
            operation.claimedAt <= claimCutoff)
        )
      ) return null;
      if (await isReferenced({
        materialId: operation.materialId,
        videoId: operation.videoId,
      })) {
        await failWithoutClaim(transaction, operation.id, operation.videoId, "referenced", now());
        return {
          category: "referenced",
          kind: "failed",
          operationId: operation.id,
        };
      }
      if (!isTerminalProviderState(operation.video.providerStatus)) {
        return {
          kind: "deferred",
          operationId: operation.id,
          projectId: operation.video.projectId,
          providerVideoId: operation.video.providerVideoId,
          videoId: operation.videoId,
        };
      }
      const claimedAt = now();
      const attempts = operation.attempts + 1;
      const cycleAttempts = operation.cycleAttempts + 1;
      await transaction.videoDeletionOperation.update({
        data: {
          attempts,
          cycleAttempts,
          claimedAt,
          lastErrorCategory: null,
          state: "deleting",
          updatedAt: claimedAt,
        },
        where: { id: operation.id },
      });
      await transaction.video.update({
        data: { failureCode: null, state: "deleting", updatedAt: claimedAt },
        where: { id: operation.videoId },
      });
      return {
        claimedAt,
        cycleAttempts,
        kind: "claimed",
        operationId: operation.id,
        origin: originSchema.parse(operation.video.origin),
        providerVideoId: operation.video.providerVideoId,
        providerVisibleAt: operation.video.providerVisibleAt,
        videoId: operation.videoId,
      };
    });
  }

  async function reconcileActiveProviderState(input: DeferredDeletion): Promise<void> {
    let remote;
    try {
      remote = await dependencies.provider.find({
        id: input.providerVideoId,
        projectId: input.projectId,
      });
    } catch {
      return;
    }
    if (
      remote === null ||
      remote.id !== input.providerVideoId ||
      remote.projectId !== input.projectId
    ) return;
    const observedAt = now();
    await dependencies.prisma.video.updateMany({
      data: {
        providerStatus: remote.status.slice(0, 64),
        providerVisibleAt: observedAt,
        updatedAt: observedAt,
      },
      where: { id: input.videoId, state: "deletion_requested" },
    });
  }

  async function completeDeletion(
    claim: DeletionClaim,
    providerRequestId: string | undefined,
  ): Promise<boolean> {
    const completedAt = now();
    return dependencies.prisma.$transaction(async (transaction) => {
      const operation = await transaction.videoDeletionOperation.updateMany({
        data: {
          completedAt,
          lastErrorCategory: null,
          providerRequestId: providerRequestId ?? null,
          state: "deleted",
          updatedAt: completedAt,
        },
        where: {
          claimedAt: claim.claimedAt,
          id: claim.operationId,
          state: "deleting",
        },
      });
      if (operation.count === 0) return false;
      await transaction.video.update({
        data: {
          deletedAt: completedAt,
          failureCode: null,
          providerEmbedLocator: null,
          providerStatus: "deleted",
          state: "deleted",
          updatedAt: completedAt,
        },
        where: { id: claim.videoId },
      });
      return true;
    });
  }

  async function scheduleRetry(
    claim: DeletionClaim,
    category: string,
    providerRequestId: string | undefined,
  ): Promise<boolean> {
    const retryAt = now();
    const baseDelayMs = Math.min(
      VIDEO_DELETION_RETRY_INITIAL_DELAY_MILLISECONDS * 2 ** (claim.cycleAttempts - 1),
      VIDEO_DELETION_RETRY_MAX_DELAY_MILLISECONDS,
    );
    const jitterMs = Math.floor(
      baseDelayMs * VIDEO_DELETION_RETRY_JITTER_RATIO * random(),
    );
    const nextAttemptAt = new Date(retryAt.getTime() + baseDelayMs + jitterMs);
    return dependencies.prisma.$transaction(async (transaction) => {
      const operation = await transaction.videoDeletionOperation.updateMany({
        data: {
          lastErrorCategory: category,
          nextAttemptAt,
          providerRequestId: providerRequestId ?? null,
          state: "deletion_requested",
          updatedAt: retryAt,
        },
        where: {
          claimedAt: claim.claimedAt,
          id: claim.operationId,
          state: "deleting",
        },
      });
      if (operation.count === 0) return false;
      await transaction.video.update({
        data: {
          failureCode: category,
          state: "deletion_requested",
          updatedAt: retryAt,
        },
        where: { id: claim.videoId },
      });
      return true;
    });
  }

  async function failDeletion(
    claim: DeletionClaim,
    category: string,
    providerRequestId: string | undefined,
  ): Promise<boolean> {
    const failedAt = now();
    return dependencies.prisma.$transaction(async (transaction) => {
      const operation = await transaction.videoDeletionOperation.updateMany({
        data: {
          lastErrorCategory: category,
          providerRequestId: providerRequestId ?? null,
          state: "delete_failed",
          updatedAt: failedAt,
        },
        where: {
          claimedAt: claim.claimedAt,
          id: claim.operationId,
          state: "deleting",
        },
      });
      if (operation.count === 0) return false;
      await transaction.video.update({
        data: {
          failureCode: category,
          state: "delete_failed",
          updatedAt: failedAt,
        },
        where: { id: claim.videoId },
      });
      return true;
    });
  }
}

interface DeletionClaim {
  readonly claimedAt: Date;
  readonly cycleAttempts: number;
  readonly kind: "claimed";
  readonly operationId: string;
  readonly origin: "external_attachment" | "platform_upload";
  readonly providerVideoId: string;
  readonly providerVisibleAt: Date | null;
  readonly videoId: string;
}

interface DeferredDeletion {
  readonly kind: "deferred";
  readonly operationId: string;
  readonly projectId: string;
  readonly providerVideoId: string;
  readonly videoId: string;
}

const originSchema = z.enum(["external_attachment", "platform_upload"]);

function isTerminalProviderState(status: string): boolean {
  return status === "done" || status === "error";
}

async function failWithoutClaim(
  transaction: VideosPrisma,
  operationId: string,
  videoId: string,
  category: string,
  failedAt: Date,
  providerRequestId?: string,
): Promise<void> {
  await transaction.videoDeletionOperation.update({
    data: {
      lastErrorCategory: category,
      providerRequestId: providerRequestId ?? null,
      state: "delete_failed",
      updatedAt: failedAt,
    },
    where: { id: operationId },
  });
  await transaction.video.update({
    data: {
      failureCode: category,
      state: "delete_failed",
      updatedAt: failedAt,
    },
    where: { id: videoId },
  });
}
