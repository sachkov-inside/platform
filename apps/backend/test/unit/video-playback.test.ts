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
  test("issues a short member token, returns account resume, and reauthorizes the provider callback", async () => {
    const authorize = vi.fn().mockResolvedValue({
      decidedAt: now.toISOString(),
      effect: "allow",
      reason: "active_membership",
    });
    const videos = videoDependencies("membership");
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
    if (!session.ok || session.value.drmAuthToken === null) throw new Error("member token missing");
    await expect(playback.authorizeProvider({
      providerVideoId: "provider-video",
      token: session.value.drmAuthToken,
    })).resolves.toBe(true);
    await expect(playback.authorizeProvider({
      providerVideoId: "other-provider-video",
      token: session.value.drmAuthToken,
    })).resolves.toBe(false);
    await expect(playback.authorizeProvider({
      providerVideoId: "provider-video",
      token: `${session.value.drmAuthToken}tampered`,
    })).resolves.toBe(false);
    const expiredPlayback = assembleVideoPlayback({
      clock: () => new Date(now.getTime() + 61_000),
      contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
      jwtSecret: "test-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      videos,
    });
    await expect(expiredPlayback.authorizeProvider({
      providerVideoId: "provider-video",
      token: session.value.drmAuthToken,
    })).resolves.toBe(false);
    expect(authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "play",
      enforcementPoint: "playback_token_issue",
      resource: { kind: "video", videoId },
    }));
    expect(authorize).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "play",
      enforcementPoint: "video_authorization_callback",
      subject: { accountId: account, kind: "account" },
    }));
  });

  test("keeps public anonymous playback tokenless and denies before loading protected facts", async () => {
    const authorize = vi.fn()
      .mockResolvedValueOnce({ decidedAt: now.toISOString(), effect: "allow", reason: "public_resource" })
      .mockResolvedValueOnce({ decidedAt: now.toISOString(), effect: "deny", reason: "membership_required" });
    const videos = videoDependencies("free");
    const playback = assembleVideoPlayback({
      clock: () => now,
      contentAccess: { authorize } satisfies Pick<ContentAccess, "authorize">,
      jwtSecret: "test-playback-secret-with-at-least-32-characters",
      jwtTtlSeconds: 60,
      videos,
    });

    await expect(playback.createSession({
      correlationId: "public-request",
      materialId,
      subject: { kind: "anonymous" },
      videoId,
    })).resolves.toMatchObject({
      ok: true,
      value: { drmAuthToken: null, progressScope: "anonymous", resumeSeconds: null },
    });
    expect(videos.loadProgress).not.toHaveBeenCalled();

    await expect(playback.createSession({
      correlationId: "denied-request",
      materialId,
      subject: { accountId: account, kind: "account" },
      videoId,
    })).resolves.toEqual({ ok: false, error: { code: "access_denied" } });
    expect(videos.loadPlayback).toHaveBeenCalledTimes(1);
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

    await expect(playback.saveProgress({
      accountId: account,
      durationSeconds: 120,
      materialId,
      positionSeconds: 37,
      videoId,
    })).resolves.toEqual({ ok: true, value: undefined });
    expect(videos.saveProgress).toHaveBeenCalledWith({
      accountId: account,
      durationSeconds: 120,
      positionSeconds: 37,
      videoId,
    });
  });
});

function videoDependencies(access: "free" | "membership") {
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
    loadProgress: vi.fn().mockResolvedValue({ ok: true, value: { positionSeconds: 77 } }),
    saveProgress: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  } satisfies Pick<Videos, "loadPlayback" | "loadProgress" | "saveProgress">;
}
