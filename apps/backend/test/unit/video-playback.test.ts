import { SignJWT, decodeJwt } from "jose";
import { describe, expect, test, vi } from "vitest";

import { accountId } from "../../src/modules/accounts/index.js";
import type { ContentAccess } from "../../src/modules/content-access/index.js";
import { assembleVideoPlayback } from "../../src/modules/materials/facets/video-playback/video-playback.js";
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
      const videos = videoDependencies("closed");
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

  test("keeps public anonymous playback tokenless and denies before loading protected facts", async () => {
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
    const videos = videoDependencies("free");
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

  test("authorizes an author preview session without progress and repeats preview in the callback", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decidedAt: now.toISOString(),
      effect: "allow",
      reason: "materials_manager",
    });
    const videos = videoDependencies("closed");
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

  test("maps progress to the strict Videos port without leaking Material context", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decidedAt: now.toISOString(),
      effect: "allow",
      reason: "public_resource",
    });
    const videos = videoDependencies("free");
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

function videoDependencies(access: "free" | "closed") {
  return {
    loadPlayback: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        access,
        embedLocator: "https://kinescope.io/embed/provider-video",
        materialId,
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
