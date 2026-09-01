import { describe, expect, test, vi } from "vitest";

import type { PlatformConfig } from "../../src/config/platform-config.js";
import { KinescopeVideoAuthorizationController } from "../../src/modules/materials/index.js";
import type { VideoPlayback } from "../../src/modules/materials/facets/video-playback/video-playback.js";
import { KinescopeWebhookController, type Videos } from "../../src/modules/videos/index.js";

const config = {
  kinescope: {
    apiBaseUrl: "https://api.kinescope.io",
    apiToken: "inside-local-kinescope-api-token",
    callbackPassword: "callback-password",
    callbackUsername: "callback-user",
    membershipProjectId: "member-project",
    playbackJwtSecret: "test-playback-secret-with-at-least-32-characters",
    playbackJwtTtlSeconds: 60,
    providerMode: "test",
    publicProjectId: "public-project",
    uploaderBaseUrl: "https://uploader.kinescope.io",
    webhookPassword: "webhook-password",
    webhookUsername: "webhook-user",
  },
} satisfies Pick<PlatformConfig, "kinescope">;

describe("Kinescope integration HTTP boundary", () => {
  test("accepts provider-supported webhook Basic auth and keeps the hint authoritative", async () => {
    const acceptWebhook = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const controller = new KinescopeWebhookController(
      { acceptWebhook } satisfies Pick<Videos, "acceptWebhook">,
      config,
    );

    await expect(controller.webhook(
      basic("webhook-user", "webhook-password"),
      {
        data: { id: "provider-video", status: "done" },
        event: "media.update.status",
      },
    )).resolves.toEqual({ accepted: true });
    expect(acceptWebhook).toHaveBeenCalledWith({
      event: "media.update.status",
      providerStatus: "done",
      providerVideoId: "provider-video",
    });

    await expect(controller.webhook(
      basic("webhook-user", "wrong-password"),
      { data: { id: "provider-video", status: "done" }, event: "media.update.status" },
    )).rejects.toMatchObject({ status: 401 });
    expect(acceptWebhook).toHaveBeenCalledTimes(1);
  });

  test("returns retryable failure for webhook reconciliation outage and denies bad DRM proof", async () => {
    const acceptWebhook = vi.fn().mockResolvedValue({
      error: { code: "dependency_unavailable", retryable: true },
      ok: false,
    });
    const authorizeProvider = vi.fn().mockResolvedValue(false);
    const controller = new KinescopeWebhookController(
      { acceptWebhook } satisfies Pick<Videos, "acceptWebhook">,
      config,
    );
    const authorizationController = new KinescopeVideoAuthorizationController(
      { authorizeProvider } satisfies Pick<VideoPlayback, "authorizeProvider">,
      config,
    );

    await expect(controller.webhook(
      basic("webhook-user", "webhook-password"),
      { data: { id: "provider-video", status: "done" }, event: "media.update.status" },
    )).rejects.toMatchObject({ response: { code: "dependency_unavailable", retryable: true }, status: 503 });
    await expect(authorizationController.authorize(
      basic("callback-user", "callback-password"),
      { id: "provider-video", token: "tampered-token", type: "video" },
    )).rejects.toMatchObject({ status: 403 });
    expect(authorizeProvider).toHaveBeenCalledWith({
      providerVideoId: "provider-video",
      token: "tampered-token",
    });
  });
});

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
