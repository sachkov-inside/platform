import { dependencyFailure, reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  newVideoId,
  newVideoUploadAttemptId,
  providerVideoIdSchema,
  videoIdSchema,
  type ProviderVideoId,
  type VideoUploadAttemptId,
} from "../../domain/video-identifiers.js";
import { ProviderUploadAuthorizationError, type VideoProvider } from "../../ports/video-provider.js";
import { initInput, type InitUploadInput } from "./video-inputs.js";
import {
  dependencyUnavailable,
  forbidden,
  invalidRequest,
  projectForAccess,
  toDto,
  uploadNotAuthorized,
  uploadOutcomeUnknown,
  type VideoContext,
} from "./video-records.js";
import type { InitVideoUploadResult, Videos } from "./videos.interface.js";
import { reconcilePendingWebhooks } from "./reconcile-video.js";

type UploadAttempt = NonNullable<Awaited<ReturnType<VideoContext["prisma"]["videoUploadAttempt"]["findFirst"]>>>;
type Step<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly result: InitVideoUploadResult };

/**
 * Starts one upload of a Material's Video. The attempt is recorded before the provider is asked,
 * so an ambiguous provider outcome is never repeated: a retry with the same key replays the
 * recorded attempt, and an unsettled attempt of the author blocks a new one.
 */
export async function initVideoUpload(
  context: VideoContext,
  input: Parameters<Videos["initUpload"]>[0],
): Promise<InitVideoUploadResult> {
  const parsed = initInput.safeParse(input);
  if (!parsed.success) return invalidRequest();
  if (!(await context.managerAllowed(parsed.data.actor))) return forbidden();
  const projectId = projectForAccess(context.projects, parsed.data.access);
  const reserved = await reserveUploadAttempt(context, parsed.data, projectId);
  if (!reserved.ok) return reserved.result;
  const { attemptId, createdAt } = reserved.value;
  const initialized = await requestProviderUpload(context, attemptId, parsed.data, projectId);
  if (!initialized.ok) return initialized.result;
  return recordUploadedVideo(context, { attemptId, createdAt, input: parsed.data, projectId, ...initialized.value });
}

/** A new attempt row, or the answer for a key or an author whose attempt already exists. */
async function reserveUploadAttempt(
  context: VideoContext,
  input: InitUploadInput,
  projectId: string,
): Promise<Step<{ readonly attemptId: VideoUploadAttemptId; readonly createdAt: Date }>> {
  const { prisma } = context;
  const sameKey = () => prisma.videoUploadAttempt.findFirst({
    where: {
      createdBy: input.actor,
      idempotencyKey: input.idempotencyKey,
      materialId: input.materialId,
    },
  });
  const unsettled = () => prisma.videoUploadAttempt.findFirst({
    where: {
      createdBy: input.actor,
      materialId: input.materialId,
      status: { in: ["initializing", "unknown"] },
    },
  });
  let attempts;
  try {
    attempts = await Promise.all([sameKey(), unsettled()]);
  } catch (error) {
    return { ok: false, result: dependencyFailure({ module: "videos", operation: "initUpload" }, error, dependencyUnavailable()) };
  }
  const [existing, unresolved] = attempts;
  if (existing !== null) {
    return { ok: false, result: await replayUploadAttempt(context, existing, input, projectId) };
  }
  if (unresolved !== null) return { ok: false, result: uploadOutcomeUnknown() };
  const attemptId = newVideoUploadAttemptId();
  const createdAt = context.now();
  try {
    await prisma.videoUploadAttempt.create({
      data: {
        access: input.access,
        byteSize: BigInt(input.byteSize),
        createdAt,
        createdBy: input.actor,
        filename: input.filename,
        id: attemptId,
        idempotencyKey: input.idempotencyKey,
        materialId: input.materialId,
        projectId,
        status: "initializing",
        title: input.title,
        updatedAt: createdAt,
      },
    });
  } catch (error) {
    // Попытка с тем же ключом, созданная параллельно, отвечает повтором, а не сбоем.
    const concurrent = await sameKey()
      .catch((lookupError: unknown) => dependencyFailure({ module: "videos", operation: "initUpload" }, lookupError, null));
    if (concurrent !== null) {
      return { ok: false, result: await replayUploadAttempt(context, concurrent, input, projectId) };
    }
    const concurrentUnresolved = await unsettled()
      .catch((lookupError: unknown) => dependencyFailure({ module: "videos", operation: "initUpload" }, lookupError, null));
    return {
      ok: false,
      result: concurrentUnresolved === null
        ? dependencyFailure({ module: "videos", operation: "initUpload" }, error, dependencyUnavailable())
        : uploadOutcomeUnknown(),
    };
  }
  return { ok: true, value: { attemptId, createdAt } };
}

/** Asks the provider for an upload endpoint; any unproven outcome marks the attempt unknown. */
async function requestProviderUpload(
  context: VideoContext,
  attemptId: VideoUploadAttemptId,
  input: InitUploadInput,
  projectId: string,
): Promise<Step<{ readonly providerVideoId: ProviderVideoId; readonly uploadEndpoint: string }>> {
  let initialized: Awaited<ReturnType<VideoProvider["initUpload"]>>;
  try {
    initialized = await context.provider.initUpload({ ...input, projectId });
  } catch (error) {
    if (error instanceof ProviderUploadAuthorizationError) {
      try {
        await context.prisma.videoUploadAttempt.update({
          where: { id: attemptId },
          data: { status: "rejected", failureCode: "upload_not_authorized", updatedAt: context.now() },
        });
        return { ok: false, result: uploadNotAuthorized() };
      } catch (markError) {
        return { ok: false, result: dependencyFailure({ module: "videos", operation: "initUpload" }, markError, uploadOutcomeUnknown()) };
      }
    }
    reportDependencyFailure({ module: "videos", operation: "initUpload" }, error);
    await markUploadOutcomeUnknown(context, attemptId);
    return { ok: false, result: uploadOutcomeUnknown() };
  }
  const providerVideoId = providerVideoIdSchema.safeParse(initialized.id);
  if (!providerVideoId.success) {
    await markUploadOutcomeUnknown(context, attemptId);
    return { ok: false, result: uploadOutcomeUnknown() };
  }
  return { ok: true, value: { providerVideoId: providerVideoId.data, uploadEndpoint: initialized.uploadEndpoint } };
}

/** Records the Video the provider created and settles the attempt in one transaction. */
async function recordUploadedVideo(
  context: VideoContext,
  upload: {
    readonly attemptId: VideoUploadAttemptId;
    readonly createdAt: Date;
    readonly input: InitUploadInput;
    readonly projectId: string;
    readonly providerVideoId: ProviderVideoId;
    readonly uploadEndpoint: string;
  },
): Promise<InitVideoUploadResult> {
  const { attemptId, createdAt, input, projectId, providerVideoId, uploadEndpoint } = upload;
  try {
    const videoId = newVideoId();
    const video = await context.prisma.$transaction(async (transaction) => {
      const saved = await transaction.video.create({
        data: {
          id: videoId,
          access: input.access,
          createdAt,
          createdBy: input.actor,
          materialId: input.materialId,
          originalFilename: input.filename,
          origin: "platform_upload",
          projectId,
          providerStatus: "uploading",
          providerVisibleAt: createdAt,
          providerVideoId,
          state: "uploading",
          title: input.title,
          updatedAt: createdAt,
        },
      });
      await transaction.videoUploadAttempt.update({
        where: { id: attemptId },
        data: {
          status: "ready",
          uploadEndpoint,
          updatedAt: context.now(),
          videoId,
        },
      });
      return saved;
    });
    if (!(await reconcilePendingWebhooks(
      context,
      providerVideoId,
      videoIdSchema.parse(video.id),
    ))) return dependencyUnavailable();
    return { ok: true, value: { providerVideoId, uploadEndpoint, video: toDto(video) } };
  } catch (error) {
    reportDependencyFailure({ module: "videos", operation: "initUpload" }, error);
    await markUploadOutcomeUnknown(context, attemptId);
    return uploadOutcomeUnknown();
  }
}

async function replayUploadAttempt(
  context: VideoContext,
  attempt: UploadAttempt,
  input: InitUploadInput,
  projectId: string,
): Promise<InitVideoUploadResult> {
  if (
    attempt.access !== input.access ||
    attempt.filename !== input.filename ||
    attempt.projectId !== projectId ||
    attempt.title !== input.title ||
    Number(attempt.byteSize) !== input.byteSize
  ) return { ok: false, error: { code: "idempotency_key_reused" } };
  if (attempt.status === "rejected") return uploadNotAuthorized();
  if (attempt.status !== "ready" || attempt.videoId === null || attempt.uploadEndpoint === null) {
    return uploadOutcomeUnknown();
  }
  try {
    const video = await context.prisma.video.findUnique({
      where: { id: videoIdSchema.parse(attempt.videoId) },
    });
    if (video === null) return uploadOutcomeUnknown();
    if (!(await reconcilePendingWebhooks(
      context,
      providerVideoIdSchema.parse(video.providerVideoId),
      videoIdSchema.parse(video.id),
    ))) return dependencyUnavailable();
    return { ok: true, value: { providerVideoId: video.providerVideoId, uploadEndpoint: attempt.uploadEndpoint, video: toDto(video) } };
  } catch (error) {
    return dependencyFailure({ module: "videos", operation: "replayUploadAttempt" }, error, dependencyUnavailable());
  }
}

async function markUploadOutcomeUnknown(context: VideoContext, attemptId: VideoUploadAttemptId): Promise<void> {
  await context.prisma.videoUploadAttempt.update({
    where: { id: attemptId },
    data: {
      failureCode: "provider_outcome_unknown",
      status: "unknown",
      updatedAt: context.now(),
    },
  }).catch((error: unknown) => {
    reportDependencyFailure({ module: "videos", operation: "markUploadOutcomeUnknown" }, error);
  });
}
