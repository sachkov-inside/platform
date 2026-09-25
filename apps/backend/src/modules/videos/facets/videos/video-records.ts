import type { VideosPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  videoIdSchema,
  videoMaterialIdSchema,
  type VideoAccountId,
} from "../../domain/video-identifiers.js";
import type { ProviderVideo, VideoProvider } from "../../ports/video-provider.js";
import {
  videoAccessSchema,
  videoAuthoringPresentationSchema,
  videoDtoSchema,
  videoStateSchema,
  type VideoAccess,
  type VideoDto,
  type VideoError,
  type VideoState,
} from "./videos.interface.js";

/** What every Videos operation works with. */
export interface VideoContext {
  readonly now: () => Date;
  readonly prisma: VideosPrismaClient;
  readonly projects: Readonly<Record<"free" | "membership", string>>;
  readonly provider: VideoProvider;
  /** False when the actor may not manage Videos, including when the answer is unavailable. */
  readonly managerAllowed: (actor: VideoAccountId) => Promise<boolean>;
}

export function projectForAccess(
  projects: Readonly<Record<"free" | "membership", string>>,
  access: VideoAccess,
): string {
  return access === "free" ? projects.free : projects.membership;
}

export function providerLifecycle(remote: ProviderVideo): {
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

export function toDto(video: { id: string; access: string; materialId: string; origin: string; state: string; title: string; failureCode: string | null; durationSeconds: number | null }): VideoDto {
  return videoDtoSchema.parse({
    access: videoAccessSchema.parse(video.access),
    materialId: videoMaterialIdSchema.parse(video.materialId),
    origin: video.origin,
    state: parseVideoState(video.state),
    title: video.title,
    videoId: videoIdSchema.parse(video.id),
    ...(video.durationSeconds === null ? {} : { durationSeconds: video.durationSeconds }),
    ...(video.failureCode === null ? {} : { failureCode: video.failureCode }),
  });
}

export function toAuthoringPresentation(video: {
  readonly failureCode: string | null;
  readonly durationSeconds: number | null;
  readonly id: string;
  readonly origin: string;
  readonly state: string;
  readonly title: string;
}) {
  return videoAuthoringPresentationSchema.parse({
    origin: video.origin,
    state: parseVideoState(video.state),
    title: video.title,
    videoId: videoIdSchema.parse(video.id),
    ...(video.durationSeconds === null ? {} : { durationSeconds: video.durationSeconds }),
    ...(video.failureCode === null ? {} : { failureCode: video.failureCode }),
  });
}

export function parseVideoState(value: string): VideoState {
  return videoStateSchema.parse(value);
}

type VideoFailure<Code extends VideoError["code"]> = Readonly<{
  ok: false;
  error: Extract<VideoError, { readonly code: Code }>;
}>;

export const invalidRequest = (): VideoFailure<"invalid_request"> => ({ ok: false, error: { code: "invalid_request" } });
export const forbidden = (): VideoFailure<"forbidden"> => ({ ok: false, error: { code: "forbidden" } });
export const dependencyUnavailable = (): VideoFailure<"dependency_unavailable"> => ({ ok: false, error: { code: "dependency_unavailable", retryable: true } });
export const providerMismatch = (): VideoFailure<"provider_mismatch"> => ({ ok: false, error: { code: "provider_mismatch" } });
export const uploadOutcomeUnknown = (): VideoFailure<"upload_outcome_unknown"> => ({ ok: false, error: { code: "upload_outcome_unknown" } });
export const videoDeletionNotRetryable = (): VideoFailure<"video_deletion_not_retryable"> => ({ ok: false, error: { code: "video_deletion_not_retryable" } });
export const videoNotFound = (): VideoFailure<"video_not_found"> => ({ ok: false, error: { code: "video_not_found" } });
export const videoNotReady = (): VideoFailure<"video_not_ready"> => ({ ok: false, error: { code: "video_not_ready" } });
export const uploadNotAuthorized = (): VideoFailure<"upload_not_authorized"> => ({ ok: false, error: { code: "upload_not_authorized" } });
