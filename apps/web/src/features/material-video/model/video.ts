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
