import { randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import type { ContentAccess, Subject } from "../../../content-access/index.js";
import type { Videos } from "../../../videos/index.js";
import { accountId as checkedAccountId } from "../../../accounts/index.js";

export const VIDEO_PLAYBACK = Symbol("VIDEO_PLAYBACK");

export type PlaybackSessionResult =
  | Readonly<{
      ok: true;
      value: {
        readonly drmAuthToken: string | null;
        readonly embedLocator: string;
        readonly progressScope: "account" | "anonymous";
        readonly resumeSeconds: number | null;
        readonly videoId: string;
      };
    }>
  | Readonly<{
      ok: false;
      error: { readonly code: "access_denied" | "dependency_unavailable" | "video_mismatch" | "video_not_ready" };
    }>;

export interface VideoPlaybackService {
  createSession(input: {
    readonly correlationId: string;
    readonly materialId: string;
    readonly subject: Subject;
    readonly videoId: string;
  }): Promise<PlaybackSessionResult>;
  authorizeProvider(input: {
    readonly providerVideoId: string;
    readonly token: string;
  }): Promise<boolean>;
  saveProgress(input: {
    readonly accountId: string;
    readonly durationSeconds: number;
    readonly materialId: string;
    readonly positionSeconds: number;
    readonly videoId: string;
  }): Promise<boolean>;
}

export function assembleVideoPlayback(dependencies: {
  readonly contentAccess: Pick<ContentAccess, "authorize">;
  readonly jwtSecret: string;
  readonly jwtTtlSeconds: number;
  readonly videos: Pick<Videos, "loadPlayback" | "loadProgress" | "saveProgress">;
  readonly clock?: () => Date;
}): VideoPlaybackService {
  const secret = new TextEncoder().encode(dependencies.jwtSecret);
  const clock = dependencies.clock ?? (() => new Date());
  const issuer = "inside-platform";
  const audience = "kinescope-drm-callback";

  const service: VideoPlaybackService = {
    async createSession(input) {
      const decision = await dependencies.contentAccess.authorize({
        action: "play",
        correlationId: input.correlationId,
        enforcementPoint: "playback_token_issue",
        resource: { kind: "video", videoId: input.videoId },
        subject: input.subject,
      });
      if (decision.effect === "deny") {
        return {
          ok: false,
          error: {
            code: decision.reason === "dependency_unavailable"
              ? "dependency_unavailable"
              : "access_denied",
          },
        };
      }
      const loaded = await dependencies.videos.loadPlayback(input.videoId);
      if (!loaded.ok) {
        return {
          ok: false,
          error: { code: loaded.error.code === "video_not_ready" ? "video_not_ready" : "dependency_unavailable" },
        };
      }
      if (loaded.value === null || loaded.value.materialId !== input.materialId) {
        return { ok: false, error: { code: "video_mismatch" } };
      }
      const progress = input.subject.kind === "account"
        ? await dependencies.videos.loadProgress({ accountId: input.subject.accountId, videoId: input.videoId })
        : { ok: true as const, value: null };
      if (!progress.ok) return { ok: false, error: { code: "dependency_unavailable" } };
      const issuedAt = Math.floor(clock().getTime() / 1000);
      const drmAuthToken = loaded.value.access === "membership"
        ? await new SignJWT({ pid: loaded.value.providerVideoId, vid: loaded.value.videoId })
            .setProtectedHeader({ alg: "HS256", typ: "JWT" })
            .setIssuer(issuer)
            .setAudience(audience)
            .setSubject(input.subject.kind === "account" ? input.subject.accountId : "")
            .setJti(randomUUID())
            .setIssuedAt(issuedAt)
            .setExpirationTime(issuedAt + dependencies.jwtTtlSeconds)
            .sign(secret)
        : null;
      return {
        ok: true,
        value: {
          drmAuthToken,
          embedLocator: loaded.value.embedLocator,
          progressScope: input.subject.kind,
          resumeSeconds: progress.value?.positionSeconds ?? null,
          videoId: loaded.value.videoId,
        },
      };
    },

    async authorizeProvider(input) {
      try {
        const verified = await jwtVerify(input.token, secret, {
          algorithms: ["HS256"],
          audience,
          issuer,
          clockTolerance: 0,
          currentDate: clock(),
        });
        const localVideoId = verified.payload.vid;
        if (typeof localVideoId !== "string" || verified.payload.pid !== input.providerVideoId || typeof verified.payload.sub !== "string") {
          return false;
        }
        const playback = await dependencies.videos.loadPlayback(localVideoId);
        if (!playback.ok || playback.value === null || playback.value.providerVideoId !== input.providerVideoId || playback.value.access !== "membership") {
          return false;
        }
        const decision = await dependencies.contentAccess.authorize({
          action: "play",
          correlationId: randomUUID(),
          enforcementPoint: "video_authorization_callback",
          resource: { kind: "video", videoId: localVideoId },
          subject: { kind: "account", accountId: checkedAccountId(verified.payload.sub) },
        });
        return decision.effect === "allow";
      } catch {
        return false;
      }
    },

    async saveProgress(input) {
      const playback = await dependencies.videos.loadPlayback(input.videoId);
      if (!playback.ok || playback.value === null || playback.value.materialId !== input.materialId) return false;
      const decision = await dependencies.contentAccess.authorize({
        action: "play",
        correlationId: randomUUID(),
        enforcementPoint: "playback_token_issue",
        resource: { kind: "video", videoId: input.videoId },
        subject: { kind: "account", accountId: checkedAccountId(input.accountId) },
      });
      if (decision.effect === "deny") return false;
      const saved = await dependencies.videos.saveProgress(input);
      return saved.ok;
    },
  };
  return Object.freeze(service);
}
