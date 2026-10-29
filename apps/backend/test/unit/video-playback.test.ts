import { generateKeyPairSync } from "node:crypto";

import { SignJWT, decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, test, vi } from "vitest";

import { accountId } from "../../src/modules/accounts/index.js";
import type { ContentAccess } from "../../src/modules/content-access/index.js";
import {
  assembleVideoPlayback,
  standPreviewKeys,
} from "../../src/modules/materials/facets/video-playback/video-playback.js";
import type { Videos } from "../../src/modules/videos/index.js";

const account = accountId("81000000-0000-4000-8000-000000000001");
const materialId = "81000000-0000-4000-8000-000000000002";
const videoId = "81000000-0000-4000-8000-000000000003";
const now = new Date("2026-09-01T12:00:00.000Z");

describe("Video playback authorization", () => {
  test.each([new Date(now.getTime() + 5 * 60_000).toISOString(), null])(
    "issues a bounded member token for validity %s and reauthorizes callbacks",
    async (validUntil) => {
      const authorize = vi.fn().mockResolvedValue({
        decidedAt: now.toISOString(),
        effect: "allow",
        reason: "active_membership",
        validUntil,
      });
      const videos = videoDependencies({ protected: true });
      const playback = assembleVideoPlayback({
        clock: () => now,
        contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
        jwtSecret: "test-playback-secret-with-at-least-32-characters",
        jwtTtlSeconds: 60,
        videos,
      });

      const session = await playback.createSession({
        correlationId: "playback-request",
        materialId,
        subject: { accountId: account, kind: "account" },
        videoId,
      });
      expect(session).toMatchObject({
        ok: true,
        value: { progressScope: "account", resumeSeconds: 77, videoId },
      });
      if (!session.ok || session.value.drmAuthToken === null)
        throw new Error("member token missing");
      expect(decodeJwt(session.value.drmAuthToken).exp).toBe(
        Math.floor(now.getTime() / 1000) + 60,
      );
      await expect(
        playback.authorizeProvider({
          providerVideoId: "provider-video",
          token: session.value.drmAuthToken,
        }),
      ).resolves.toBe(true);
      await expect(
        playback.authorizeProvider({
          providerVideoId: "other-provider-video",
          token: session.value.drmAuthToken,
        }),
      ).resolves.toBe(false);
      await expect(
        playback.authorizeProvider({
          providerVideoId: "provider-video",
          token: `${session.value.drmAuthToken}tampered`,
        }),
      ).resolves.toBe(false);
      const expiredPlayback = assembleVideoPlayback({
        clock: () => new Date(now.getTime() + 61_000),
        contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
        jwtSecret: "test-playback-secret-with-at-least-32-characters",
        jwtTtlSeconds: 60,
        videos,
      });
      await expect(
        expiredPlayback.authorizeProvider({
          providerVideoId: "provider-video",
          token: session.value.drmAuthToken,
        }),
      ).resolves.toBe(false);
      expect(authorize).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          action: "play",
          enforcementPoint: "playback_token_issue",
          resource: { kind: "video", videoId },
        }),
      );
      expect(authorize).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          action: "play",
          enforcementPoint: "video_authorization_callback",
          subject: { accountId: account, kind: "account" },
        }),
      );
    },
  );

  test("keeps a public recording tokenless and denies before loading protected facts", async () => {
    const authorize = vi
      .fn()
      .mockResolvedValueOnce({
        decidedAt: now.toISOString(),
        effect: "allow",
        reason: "public_resource",
      })
      .mockResolvedValueOnce({
        decidedAt: now.toISOString(),
        effect: "deny",
        reason: "membership_required",
      });
    const videos = videoDependencies({ protected: false });
    const playback = assembleVideoPlayback({
      clock: () => now,
      contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
      jwtSecret: "test-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      videos,
    });

    await expect(
      playback.createSession({
        correlationId: "public-request",
        materialId,
        subject: { kind: "anonymous" },
        videoId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        drmAuthToken: null,
        progressScope: "anonymous",
        resumeSeconds: null,
      },
    });
    expect(videos.loadProgress).not.toHaveBeenCalled();

    await expect(
      playback.createSession({
        correlationId: "denied-request",
        materialId,
        subject: { accountId: account, kind: "account" },
        videoId,
      }),
    ).resolves.toEqual({ ok: false, error: { code: "access_denied" } });
    expect(videos.loadPlayback).toHaveBeenCalledTimes(1);
  });

  test("gives an anonymous viewer of a free lesson a token for its protected recording", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decidedAt: now.toISOString(),
      effect: "allow",
      reason: "public_resource",
    });
    const videos = videoDependencies({ protected: true });
    const playback = assembleVideoPlayback({
      clock: () => now,
      contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
      jwtSecret: "test-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      videos,
    });

    const session = await playback.createSession({
      correlationId: "free-protected-request",
      materialId,
      subject: { kind: "anonymous" },
      videoId,
    });
    expect(session).toMatchObject({
      ok: true,
      value: { progressScope: "anonymous", resumeSeconds: null },
    });
    if (!session.ok || session.value.drmAuthToken === null)
      throw new Error("anonymous token missing");
    expect(decodeJwt(session.value.drmAuthToken).sub).toBe("");
    await expect(
      playback.authorizeProvider({
        providerVideoId: "provider-video",
        token: session.value.drmAuthToken,
      }),
    ).resolves.toBe(true);
    expect(authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "play",
        enforcementPoint: "video_authorization_callback",
        subject: { kind: "anonymous" },
      }),
    );

    // The lesson was closed after the token was issued: the callback repeats the decision.
    authorize.mockResolvedValueOnce({
      decidedAt: now.toISOString(),
      effect: "deny",
      reason: "authentication_required",
    });
    await expect(
      playback.authorizeProvider({
        providerVideoId: "provider-video",
        token: session.value.drmAuthToken,
      }),
    ).resolves.toBe(false);
  });

  test("refuses a callback for a public recording even with a valid token", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decidedAt: now.toISOString(),
      effect: "allow",
      reason: "public_resource",
    });
    const playback = assembleVideoPlayback({
      clock: () => now,
      contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
      jwtSecret: "test-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      videos: videoDependencies({ protected: false }),
    });
    const token = await new SignJWT({ pid: "provider-video", vid: videoId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("inside-platform")
      .setAudience("kinescope-drm-callback")
      .setSubject("")
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 60)
      .sign(
        new TextEncoder().encode(
          "test-playback-secret-with-at-least-32-characters",
        ),
      );

    await expect(
      playback.authorizeProvider({ providerVideoId: "provider-video", token }),
    ).resolves.toBe(false);
    expect(authorize).not.toHaveBeenCalled();
  });

  test("authorizes an author preview session without progress and repeats preview in the callback", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decidedAt: now.toISOString(),
      effect: "allow",
      reason: "materials_manager",
    });
    const videos = videoDependencies({ protected: true });
    const playback = assembleVideoPlayback({
      clock: () => now,
      contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
      jwtSecret: "test-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      videos,
    });

    const session = await playback.createSession({
      correlationId: "preview-request",
      materialId,
      preview: true,
      subject: { accountId: account, kind: "account" },
      videoId,
    });
    expect(session).toMatchObject({
      ok: true,
      value: { progressScope: "account", resumeSeconds: null, videoId },
    });
    expect(videos.loadProgress).not.toHaveBeenCalled();
    if (!session.ok || session.value.drmAuthToken === null)
      throw new Error("preview token missing");
    await expect(
      playback.authorizeProvider({
        providerVideoId: "provider-video",
        token: session.value.drmAuthToken,
      }),
    ).resolves.toBe(true);
    expect(authorize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "preview",
        enforcementPoint: "playback_token_issue",
      }),
    );
    expect(authorize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "preview",
        enforcementPoint: "video_authorization_callback",
      }),
    );

    const forged = await new SignJWT({
      act: "download",
      pid: "provider-video",
      vid: videoId,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("inside-platform")
      .setAudience("kinescope-drm-callback")
      .setSubject(account)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + 60)
      .sign(
        new TextEncoder().encode(
          "test-playback-secret-with-at-least-32-characters",
        ),
      );
    await expect(
      playback.authorizeProvider({
        providerVideoId: "provider-video",
        token: forged,
      }),
    ).resolves.toBe(false);
    expect(authorize).toHaveBeenCalledTimes(2);

    authorize.mockResolvedValueOnce({
      decidedAt: now.toISOString(),
      effect: "deny",
      reason: "permission_required",
    });
    await expect(
      playback.authorizeProvider({
        providerVideoId: "provider-video",
        token: session.value.drmAuthToken,
      }),
    ).resolves.toBe(false);
  });

  test("lets production accept the stand's short author preview of a protected recording only", async () => {
    const stand = standKeyHalves();
    const managerAllows = vi.fn().mockResolvedValue({
      decidedAt: now.toISOString(),
      effect: "allow",
      reason: "materials_manager",
    });
    const standPlayback = assembleVideoPlayback({
      clock: () => now,
      contentAccess: { authorize: managerAllows },
      jwtSecret: "stand-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      standPreview: standPreviewKeys(stand),
      videos: videoDependencies({ protected: true }),
    });
    const productionAuthorize = vi.fn();
    const production = (
      keys = standPreviewKeys({
        privateKey: undefined,
        publicKey: stand.publicKey,
      }),
      clock = () => now,
    ) =>
      assembleVideoPlayback({
        clock,
        contentAccess: { authorize: productionAuthorize },
        jwtSecret: "production-playback-secret-with-at-least-32-characters",
        jwtTtlSeconds: 60,
        standPreview: keys,
        // Production knows no stand Video: a lookup would find nothing.
        videos: {
          ...videoDependencies({ protected: true }),
          loadPlayback: vi.fn().mockResolvedValue({ ok: true, value: null }),
        },
      });

    const preview = await standPlayback.createSession({
      correlationId: "stand-preview",
      materialId,
      preview: true,
      subject: { accountId: account, kind: "account" },
      videoId,
    });
    if (!preview.ok || preview.value.drmAuthToken === null)
      throw new Error("stand preview token missing");
    const token = preview.value.drmAuthToken;
    expect(decodeProtectedHeader(token).alg).toBe("EdDSA");
    expect(decodeJwt(token)).toMatchObject({
      act: "preview",
      aud: "kinescope-drm-callback",
      iss: "inside-stand",
      pid: "provider-video",
      sub: account,
    });
    expect(decodeJwt(token)).not.toHaveProperty("vid");
    await expect(
      production().authorizeProvider({
        providerVideoId: "provider-video",
        token,
      }),
    ).resolves.toBe(true);
    expect(productionAuthorize).not.toHaveBeenCalled();

    // Another recording, an expired token, a production without the key or with another key refuse.
    await expect(
      production().authorizeProvider({ providerVideoId: "other-video", token }),
    ).resolves.toBe(false);
    await expect(
      // Past the token's 60 seconds and the stand's five seconds of clock drift.
      production(
        undefined,
        () => new Date(now.getTime() + 66_000),
      ).authorizeProvider({
        providerVideoId: "provider-video",
        token,
      }),
    ).resolves.toBe(false);
    await expect(
      production({}).authorizeProvider({
        providerVideoId: "provider-video",
        token,
      }),
    ).resolves.toBe(false);
    await expect(
      production(
        standPreviewKeys({
          privateKey: undefined,
          publicKey: standKeyHalves().publicKey,
        }),
      ).authorizeProvider({ providerVideoId: "provider-video", token }),
    ).resolves.toBe(false);

    // A forged play or long token is refused.
    const signing = standPreviewKeys(stand).signing;
    if (signing === undefined) throw new Error("stand signing key missing");
    const forge = (claims: Record<string, unknown>, lifetime: number) =>
      new SignJWT({ pid: "provider-video", ...claims })
        .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
        .setIssuer("inside-stand")
        .setAudience("kinescope-drm-callback")
        .setSubject(account)
        .setJti("forged")
        .setIssuedAt(Math.floor(now.getTime() / 1000))
        .setExpirationTime(Math.floor(now.getTime() / 1000) + lifetime)
        .sign(signing);
    const issuedLater = await new SignJWT({
      act: "preview",
      pid: "provider-video",
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setIssuer("inside-stand")
      .setAudience("kinescope-drm-callback")
      .setSubject(account)
      .setJti("issued-later")
      .setIssuedAt(Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60)
      .setExpirationTime(
        Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60 + 60,
      )
      .sign(signing);
    for (const forged of [
      await forge({ act: "play" }, 60),
      await forge({}, 60),
      await forge({ act: "preview" }, 301),
      // A future issue time would otherwise keep a five-minute token valid for a year.
      issuedLater,
    ])
      await expect(
        production().authorizeProvider({
          providerVideoId: "provider-video",
          token: forged,
        }),
      ).resolves.toBe(false);
  });

  test("lets the stand reader of a materials manager play a protected recording with the stand preview token", async () => {
    const stand = standKeyHalves();
    const learner = accountId("81000000-0000-4000-8000-000000000004");
    const decided = {
      checkedContentVersion: 1,
      decidedAt: now.toISOString(),
      decisionId: "stand-reader-decision",
      policyVersion: "content-access-v1",
    } as const;
    const authorize = vi.fn<ContentAccess["authorize"]>(async (input) => {
      const manager =
        input.subject.kind === "account" && input.subject.accountId === account;
      if (input.action === "play")
        return manager
          ? { ...decided, effect: "allow", reason: "materials_manager" }
          : {
              ...decided,
              effect: "allow",
              reason: "active_membership",
              validUntil: null,
            };
      return manager
        ? { ...decided, effect: "allow", reason: "materials_manager" }
        : { ...decided, effect: "deny", reason: "permission_required" };
    });
    const standReader = (
      keys = standPreviewKeys(stand),
      recording = { protected: true },
    ) =>
      assembleVideoPlayback({
        clock: () => now,
        contentAccess: { authorize },
        jwtSecret: "stand-playback-secret-with-at-least-32-characters",
        jwtTtlSeconds: 3_600,
        standPreview: keys,
        videos: videoDependencies(recording),
      });
    const production = assembleVideoPlayback({
      clock: () => now,
      contentAccess: { authorize: vi.fn() },
      jwtSecret: "production-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      standPreview: standPreviewKeys({
        privateKey: undefined,
        publicKey: stand.publicKey,
      }),
      videos: {
        ...videoDependencies({ protected: true }),
        loadPlayback: vi.fn().mockResolvedValue({ ok: true, value: null }),
      },
    });
    const play = (
      playback: ReturnType<typeof assembleVideoPlayback>,
      subject: Parameters<typeof playback.createSession>[0]["subject"],
    ) =>
      playback.createSession({
        correlationId: "stand-reader",
        materialId,
        subject,
        videoId,
      });

    const reader = await play(standReader(), {
      accountId: account,
      kind: "account",
    });
    // The reader keeps its progress; only the token follows the author preview.
    expect(reader).toMatchObject({
      ok: true,
      value: { progressScope: "account", resumeSeconds: 77, videoId },
    });
    if (!reader.ok || reader.value.drmAuthToken === null)
      throw new Error("stand reader token missing");
    const token = reader.value.drmAuthToken;
    expect(decodeProtectedHeader(token).alg).toBe("EdDSA");
    const claims = decodeJwt(token);
    expect(claims).toMatchObject({
      act: "preview",
      iss: "inside-stand",
      pid: "provider-video",
      sub: account,
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(300);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "preview",
        enforcementPoint: "playback_token_issue",
        resource: { kind: "video", videoId },
      }),
    );
    await expect(
      production.authorizeProvider({
        providerVideoId: "provider-video",
        token,
      }),
    ).resolves.toBe(true);

    // A learner, an anonymous viewer, a public recording and a contour without the private half keep the old path.
    const learnerSession = await play(standReader(), {
      accountId: learner,
      kind: "account",
    });
    if (!learnerSession.ok || learnerSession.value.drmAuthToken === null)
      throw new Error("learner token missing");
    expect(decodeProtectedHeader(learnerSession.value.drmAuthToken).alg).toBe(
      "HS256",
    );
    expect(decodeJwt(learnerSession.value.drmAuthToken)).not.toHaveProperty(
      "act",
    );
    // Production still refuses the stand's play token.
    await expect(
      production.authorizeProvider({
        providerVideoId: "provider-video",
        token: learnerSession.value.drmAuthToken,
      }),
    ).resolves.toBe(false);

    authorize.mockClear();
    const anonymous = await play(standReader(), { kind: "anonymous" });
    if (!anonymous.ok || anonymous.value.drmAuthToken === null)
      throw new Error("anonymous token missing");
    expect(decodeProtectedHeader(anonymous.value.drmAuthToken).alg).toBe(
      "HS256",
    );
    await expect(
      play(standReader(undefined, { protected: false }), {
        accountId: account,
        kind: "account",
      }),
    ).resolves.toMatchObject({ ok: true, value: { drmAuthToken: null } });
    const verifyOnly = await play(
      standReader(
        standPreviewKeys({ privateKey: undefined, publicKey: stand.publicKey }),
      ),
      { accountId: account, kind: "account" },
    );
    if (!verifyOnly.ok || verifyOnly.value.drmAuthToken === null)
      throw new Error("verify-only token missing");
    expect(decodeProtectedHeader(verifyOnly.value.drmAuthToken).alg).toBe(
      "HS256",
    );
    expect(authorize).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "preview" }),
    );

    // A denied play issues no session, whatever the subject could preview.
    authorize.mockResolvedValueOnce({
      ...decided,
      effect: "deny",
      reason: "resource_unpublished",
    });
    await expect(
      play(standReader(), { accountId: account, kind: "account" }),
    ).resolves.toEqual({ ok: false, error: { code: "access_denied" } });
  });

  test("maps progress to the strict Videos port without leaking Material context", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decidedAt: now.toISOString(),
      effect: "allow",
      reason: "public_resource",
    });
    const videos = videoDependencies({ protected: false });
    const playback = assembleVideoPlayback({
      clock: () => now,
      contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
      jwtSecret: "test-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      videos,
    });

    await expect(
      playback.saveProgress({
        accountId: account,
        durationSeconds: 120,
        materialId,
        positionSeconds: 37,
        videoId,
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(videos.saveProgress).toHaveBeenCalledWith({
      accountId: account,
      durationSeconds: 120,
      positionSeconds: 37,
      videoId,
    });
  });
});

function videoDependencies(recording: { readonly protected: boolean }) {
  return {
    loadPlayback: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        embedLocator: "https://kinescope.io/embed/provider-video",
        materialId,
        protected: recording.protected,
        providerVideoId: "provider-video",
        videoId,
      },
    }),
    loadProgress: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { positionSeconds: 77 } }),
    saveProgress: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  } satisfies Pick<Videos, "loadPlayback" | "loadProgress" | "saveProgress">;
}

function standKeyHalves() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateJwk = privateKey.export({ format: "jwk" });
  const publicJwk = publicKey.export({ format: "jwk" });
  if (privateJwk.d === undefined || publicJwk.x === undefined)
    throw new Error("Ed25519 key export failed");
  return { privateKey: privateJwk.d, publicKey: publicJwk.x };
}
