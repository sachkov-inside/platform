import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  type KeyObject,
} from "node:crypto";

import { SignJWT, decodeProtectedHeader, jwtVerify } from "jose";

import {
  anonymousSubject,
  type ContentAccess,
  type Subject,
} from "../../../content-access/index.js";
import type { Videos } from "../../../videos/index.js";
import { accountId as checkedAccountId } from "../../../accounts/index.js";
import { writeLog } from "../../../../infrastructure/observability/index.js";

export const VIDEO_PLAYBACK = Symbol("VIDEO_PLAYBACK");

export type VideoPlaybackError =
  | Readonly<{ code: "access_denied" }>
  | Readonly<{ code: "dependency_unavailable" }>
  | Readonly<{ code: "invalid_request" }>
  | Readonly<{ code: "video_mismatch" }>
  | Readonly<{ code: "video_not_ready" }>;

type VideoPlaybackFailure = {
  [Code in VideoPlaybackError["code"]]: Readonly<{
    ok: false;
    error: Extract<VideoPlaybackError, { readonly code: Code }>;
  }>;
}[VideoPlaybackError["code"]];

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
  | VideoPlaybackFailure;

export type SaveVideoProgressResult =
  Readonly<{ ok: true; value: undefined }> | VideoPlaybackFailure;

export interface VideoPlayback {
  createSession(input: {
    readonly correlationId: string;
    readonly materialId: string;
    /** Author preview of the current saved Material: needs `materials:manage`, keeps no progress. */
    readonly preview?: boolean;
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
  }): Promise<SaveVideoProgressResult>;
}

/**
 * The stand's author preview of a protected recording: production's callback has no stand Video
 * to check, so it trusts the stand's Ed25519 signature for a short preview only (#1808).
 */
export interface StandPreviewKeys {
  /** On the stand: signs a preview of a protected recording, or a materials manager's reading of one. */
  readonly signing?: KeyObject;
  /** On production: accepts such a preview in the provider callback. */
  readonly verification?: KeyObject;
}

/** Ed25519 keys from their base64url JWK halves; the stand holds both, production only the public one. */
export function standPreviewKeys(halves: {
  readonly privateKey: string | undefined;
  readonly publicKey: string | undefined;
}): StandPreviewKeys {
  if (halves.publicKey === undefined) return {};
  const jwk = { crv: "Ed25519", kty: "OKP", x: halves.publicKey };
  return {
    verification: createPublicKey({ format: "jwk", key: jwk }),
    ...(halves.privateKey === undefined
      ? {}
      : {
          signing: createPrivateKey({
            format: "jwk",
            key: { ...jwk, d: halves.privateKey },
          }),
        }),
  };
}

const STAND_PREVIEW_ISSUER = "inside-stand";
/** Production accepts no stand preview that lives longer, whatever the stand's TTL. */
const STAND_PREVIEW_MAX_SECONDS = 300;
const STAND_PREVIEW_CLOCK_SKEW_SECONDS = 5;

export function assembleVideoPlayback(dependencies: {
  readonly contentAccess: Pick<ContentAccess, "authorize">;
  readonly jwtSecret: string;
  readonly jwtTtlSeconds: number;
  readonly standPreview?: StandPreviewKeys;
  readonly videos: Pick<
    Videos,
    "loadPlayback" | "loadProgress" | "saveProgress"
  >;
  readonly clock?: () => Date;
}): VideoPlayback {
  const secret = new TextEncoder().encode(dependencies.jwtSecret);
  const clock = dependencies.clock ?? (() => new Date());
  const issuer = "inside-platform";
  const audience = "kinescope-drm-callback";

  const playback: VideoPlayback = {
    async createSession(input) {
      const action = input.preview === true ? "preview" : "play";
      const decision = await dependencies.contentAccess.authorize({
        action,
        correlationId: input.correlationId,
        enforcementPoint: "playback_token_issue",
        resource: { kind: "video", videoId: input.videoId },
        subject: input.subject,
      });
      if (decision.effect === "deny") {
        return decision.reason === "dependency_unavailable"
          ? failure("dependency_unavailable")
          : failure("access_denied");
      }
      const loaded = await dependencies.videos.loadPlayback(input.videoId);
      if (!loaded.ok) {
        switch (loaded.error.code) {
          case "dependency_unavailable":
            return failure("dependency_unavailable");
          case "invalid_request":
            return failure("invalid_request");
          case "video_not_ready":
            return failure("video_not_ready");
          default:
            return assertNever(loaded.error);
        }
      }
      if (
        loaded.value === null ||
        loaded.value.materialId !== input.materialId
      ) {
        return { ok: false, error: { code: "video_mismatch" } };
      }
      const progress =
        action === "play" && input.subject.kind === "account"
          ? await dependencies.videos.loadProgress({
              accountId: input.subject.accountId,
              videoId: input.videoId,
            })
          : { ok: true as const, value: null };
      if (!progress.ok) {
        switch (progress.error.code) {
          case "dependency_unavailable":
            return failure("dependency_unavailable");
          case "invalid_request":
            return failure("invalid_request");
          default:
            return assertNever(progress.error);
        }
      }
      const issuedAt = Math.floor(clock().getTime() / 1000);
      const expiresAt =
        decision.reason === "active_membership" && decision.validUntil !== null
          ? Math.min(
              issuedAt + dependencies.jwtTtlSeconds,
              Math.floor(Date.parse(decision.validUntil) / 1_000),
            )
          : issuedAt + dependencies.jwtTtlSeconds;
      // A protected recording needs a token for every viewer, including an anonymous one of a
      // free Material: access is the Material's and may change without moving the recording.
      const standSigning = dependencies.standPreview?.signing;
      const drmAuthToken = !loaded.value.protected
        ? null
        : standSigning !== undefined &&
            (action === "preview" || (await readsAsAuthor(input)))
          ? await new SignJWT({
              // Production accepts the stand key for previews only; the author's reading is one too.
              act: "preview",
              pid: loaded.value.providerVideoId,
            })
              .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
              .setIssuer(STAND_PREVIEW_ISSUER)
              .setAudience(audience)
              .setSubject(
                input.subject.kind === "account" ? input.subject.accountId : "",
              )
              .setJti(randomUUID())
              .setIssuedAt(issuedAt)
              .setExpirationTime(
                issuedAt +
                  Math.min(
                    dependencies.jwtTtlSeconds,
                    STAND_PREVIEW_MAX_SECONDS,
                  ),
              )
              .sign(standSigning)
          : await new SignJWT({
              // The provider callback repeats the same action: a preview token stays a preview.
              ...(action === "preview" ? { act: action } : {}),
              pid: loaded.value.providerVideoId,
              vid: loaded.value.videoId,
            })
              .setProtectedHeader({ alg: "HS256", typ: "JWT" })
              .setIssuer(issuer)
              .setAudience(audience)
              .setSubject(
                input.subject.kind === "account" ? input.subject.accountId : "",
              )
              .setJti(randomUUID())
              .setIssuedAt(issuedAt)
              .setExpirationTime(expiresAt)
              .sign(secret);
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
        if (decodeProtectedHeader(input.token).alg === "EdDSA")
          return await authorizeStandPreview(input);
        const verified = await jwtVerify(input.token, secret, {
          algorithms: ["HS256"],
          audience,
          issuer,
          clockTolerance: 0,
          currentDate: clock(),
        });
        const localVideoId = verified.payload["vid"];
        const tokenAction = verified.payload["act"];
        if (
          typeof localVideoId !== "string" ||
          (tokenAction !== undefined && tokenAction !== "preview") ||
          verified.payload["pid"] !== input.providerVideoId ||
          typeof verified.payload.sub !== "string"
        ) {
          return false;
        }
        const playback = await dependencies.videos.loadPlayback(localVideoId);
        if (
          !playback.ok ||
          playback.value === null ||
          playback.value.providerVideoId !== input.providerVideoId ||
          !playback.value.protected
        ) {
          return false;
        }
        // An empty subject is the anonymous viewer the session was issued to.
        const decision = await dependencies.contentAccess.authorize({
          action: tokenAction ?? "play",
          correlationId: randomUUID(),
          enforcementPoint: "video_authorization_callback",
          resource: { kind: "video", videoId: localVideoId },
          subject:
            verified.payload.sub === ""
              ? anonymousSubject
              : {
                  kind: "account",
                  accountId: checkedAccountId(verified.payload.sub),
                },
        });
        return decision.effect === "allow";
      } catch {
        // Not a dependency failure: a token that fails verification is refused; dependencies answer here with results, not exceptions.
        return false;
      }
    },

    async saveProgress(input) {
      const playback = await dependencies.videos.loadPlayback(input.videoId);
      if (!playback.ok) {
        switch (playback.error.code) {
          case "dependency_unavailable":
            return failure("dependency_unavailable");
          case "invalid_request":
            return failure("invalid_request");
          case "video_not_ready":
            return failure("video_not_ready");
          default:
            return assertNever(playback.error);
        }
      }
      if (
        playback.value === null ||
        playback.value.materialId !== input.materialId
      ) {
        return failure("video_mismatch");
      }
      let subject: Subject;
      try {
        subject = {
          kind: "account",
          accountId: checkedAccountId(input.accountId),
        };
      } catch {
        // Not a dependency failure: the account identifier in the request is malformed.
        return failure("invalid_request");
      }
      const decision = await dependencies.contentAccess.authorize({
        action: "play",
        correlationId: randomUUID(),
        enforcementPoint: "playback_token_issue",
        resource: { kind: "video", videoId: input.videoId },
        subject,
      });
      if (decision.effect === "deny") {
        return decision.reason === "dependency_unavailable"
          ? failure("dependency_unavailable")
          : failure("access_denied");
      }
      const saved = await dependencies.videos.saveProgress({
        accountId: input.accountId,
        durationSeconds: input.durationSeconds,
        positionSeconds: input.positionSeconds,
        videoId: input.videoId,
      });
      if (saved.ok) return { ok: true, value: undefined };
      switch (saved.error.code) {
        case "dependency_unavailable":
          return failure("dependency_unavailable");
        case "invalid_request":
          return failure("invalid_request");
        case "video_not_ready":
          return failure("video_not_ready");
        default:
          return assertNever(saved.error);
      }
    },
  };
  return Object.freeze(playback);

  /**
   * The stand's reader of a materials manager: production refuses the stand's play tokens, so the
   * owner's reading takes the author preview's token once play itself is allowed (#1819).
   */
  async function readsAsAuthor(input: {
    readonly correlationId: string;
    readonly subject: Subject;
    readonly videoId: string;
  }): Promise<boolean> {
    if (input.subject.kind !== "account") return false;
    const decision = await dependencies.contentAccess.authorize({
      action: "preview",
      correlationId: input.correlationId,
      enforcementPoint: "playback_token_issue",
      resource: { kind: "video", videoId: input.videoId },
      subject: input.subject,
    });
    return decision.effect === "allow";
  }

  /** Throws for a token that fails verification; the caller refuses it. */
  async function authorizeStandPreview(input: {
    readonly providerVideoId: string;
    readonly token: string;
  }): Promise<boolean> {
    const key = dependencies.standPreview?.verification;
    if (key === undefined) return false;
    // `maxTokenAge` also refuses an `iat` in the future, so a key holder cannot stretch a token's
    // life past five minutes from now; the small tolerance covers the stand's clock drift only.
    const verified = await jwtVerify(input.token, key, {
      algorithms: ["EdDSA"],
      audience,
      issuer: STAND_PREVIEW_ISSUER,
      clockTolerance: STAND_PREVIEW_CLOCK_SKEW_SECONDS,
      currentDate: clock(),
      maxTokenAge: STAND_PREVIEW_MAX_SECONDS,
      requiredClaims: ["exp", "iat", "jti", "sub"],
    });
    const { exp, iat, jti, sub } = verified.payload;
    if (
      verified.payload["act"] !== "preview" ||
      verified.payload["pid"] !== input.providerVideoId ||
      exp === undefined ||
      iat === undefined ||
      exp - iat > STAND_PREVIEW_MAX_SECONDS
    )
      return false;
    // Production holds no stand Video or Account: the signature is the stand's whole answer, so
    // every accepted preview leaves a record for the owner.
    writeLog("info", "stand_preview_authorized", {
      jti,
      providerVideoId: input.providerVideoId,
      standAccountId: sub,
    });
    return true;
  }
}

type PlaybackErrorCode = Extract<
  PlaybackSessionResult,
  { readonly ok: false }
>["error"]["code"];

function failure<Code extends PlaybackErrorCode>(
  code: Code,
): Readonly<{
  ok: false;
  error: { readonly code: Code };
}> {
  return { ok: false, error: { code } };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Video playback result: ${JSON.stringify(value)}`);
}
