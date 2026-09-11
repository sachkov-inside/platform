import { z } from "zod";

export const authoringVideoSchema = z.object({
  durationSeconds: z.number().int().positive().optional(),
  failureCode: z.string().optional(),
  origin: z.enum(["external_attachment", "platform_upload"]),
  state: z.enum([
    "uploading",
    "processing",
    "ready",
    "failed",
    "deletion_requested",
    "deleting",
    "deleted",
    "delete_failed",
  ]),
  title: z.string(),
  videoId: z.uuid(),
}).strict();

export const videoSchema = authoringVideoSchema.extend({
  access: z.enum(["free", "membership"]),
  materialId: z.uuid(),
}).strict();

export type MaterialAuthoringVideo = z.infer<typeof authoringVideoSchema>;
export type MaterialVideo = z.infer<typeof videoSchema>;

export type MaterialVideoAuthoringPhase =
  | "idle"
  | "uploading"
  | "processing"
  | "ready"
  | "error"
  | "interrupted_unusable"
  | "upload_not_authorized"
  | "upload_outcome_unknown";

export interface InitialVideoAuthoring {
  readonly phase: MaterialVideoAuthoringPhase;
  readonly recoveredVideoId: string | null;
  readonly video: MaterialAuthoringVideo | null;
}

/**
 * A Material stores its primary Video only once that Video is ready, so an editor tab closed
 * during upload or processing leaves a real Kinescope Video with nothing pointing at it. The
 * editor adopts that unselected upload instead of opening as if no video existed, and hands it
 * straight to the ordinary reconciliation poll: only the provider knows how the transfer ended.
 */
export function resolveInitialVideoAuthoring(input: {
  readonly primaryVideo: MaterialAuthoringVideo | null;
  readonly unselectedUpload: MaterialAuthoringVideo | null;
}): InitialVideoAuthoring {
  const recovered = input.primaryVideo === null ? input.unselectedUpload : null;
  return recovered === null
    ? {
        phase: phaseForVideo(input.primaryVideo),
        recoveredVideoId: null,
        video: input.primaryVideo,
      }
    : { phase: "processing", recoveredVideoId: recovered.videoId, video: recovered };
}

/**
 * The browser draft answers the same question the server answered when the Material was loaded,
 * for a choice the author has made but not saved yet.
 */
export function retainUnselectedUpload(input: {
  readonly deleteVideoId: string | null;
  readonly primaryVideoId: string | null;
  readonly unselectedUpload: MaterialAuthoringVideo | null;
}): MaterialAuthoringVideo | null {
  if (input.unselectedUpload === null || input.primaryVideoId !== null) return null;
  return input.unselectedUpload.videoId === input.deleteVideoId
    ? null
    : input.unselectedUpload;
}

/**
 * Reconciliation continues while the provider still owns the answer. A Video of this session and
 * an adopted upload use the same gate: only Kinescope can end an unfinished state.
 */
export function awaitsReconciliation(input: {
  readonly materialId: string | null;
  readonly phase: MaterialVideoAuthoringPhase;
  readonly video: MaterialAuthoringVideo | null;
}): boolean {
  if (input.materialId === null || input.phase !== "processing") return false;
  return (
    input.video !== null &&
    input.video.state !== "ready" &&
    input.video.state !== "failed"
  );
}

export function phaseForVideo(
  video: MaterialAuthoringVideo | null,
): MaterialVideoAuthoringPhase {
  if (video === null) return "idle";
  if (video.state === "ready") return "ready";
  if (video.state === "failed") return "error";
  return video.state === "uploading" ? "uploading" : "processing";
}

/**
 * An adopted upload has no browser transfer left to finish it. Once the provider reports that the
 * file never arrived in full, or that it could not be processed, neither waiting nor checking
 * again can change the outcome, so the author is told to upload the file again instead.
 */
export function phaseForReconciledVideo(
  video: MaterialAuthoringVideo,
  recoveredVideoId: string | null,
): MaterialVideoAuthoringPhase {
  if (video.state === "ready") return "ready";
  if (recoveredVideoId === video.videoId && video.state !== "processing") {
    return "interrupted_unusable";
  }
  return video.state === "failed" ? "error" : "processing";
}

export interface VideoPlaybackProgress {
  readonly resumeSeconds: number | null;
  readonly watched: boolean;
}

export function resolveVideoPlaybackProgress(
  savedPositionSeconds: number | null,
  durationSeconds: number,
): VideoPlaybackProgress {
  const watched = savedPositionSeconds !== null &&
    isVideoWatchedPosition(savedPositionSeconds, durationSeconds);
  return {
    resumeSeconds: watched ? 0 : savedPositionSeconds,
    watched,
  };
}

export function isVideoWatchedPosition(
  positionSeconds: number,
  durationSeconds: number,
): boolean {
  return positionSeconds >= Math.max(1, durationSeconds - 5);
}

/** A material link may select a moment explicitly using #t=<whole seconds>. */
export function readVideoTimeFragment(fragment: string, durationSeconds: number): number | null {
  const value = new URLSearchParams(fragment.replace(/^#/u, "")).getAll("t");
  if (value.length !== 1) return null;
  const parsed = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).safeParse(value[0]);
  return parsed.success && parsed.data < durationSeconds ? parsed.data : null;
}

export function resolveVideoStartPosition(savedPositionSeconds: number | null, durationSeconds: number, fragment: string): number | null {
  return readVideoTimeFragment(fragment, durationSeconds) ?? resolveVideoPlaybackProgress(savedPositionSeconds, durationSeconds).resumeSeconds;
}
