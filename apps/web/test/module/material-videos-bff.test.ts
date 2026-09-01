import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  getOptionalAccessToken: vi.fn(),
  requestPlayback: vi.fn(),
}));

vi.mock("@/shared/api/backend/index.server", () => ({
  requestVideoPlayback: fakes.requestPlayback,
  requestVideoProgress: vi.fn(),
}));

vi.mock("@/shared/auth/index.server", () => ({
  getOptionalPlatformAccessToken: fakes.getOptionalAccessToken,
  handleAuthenticatedMutation: vi.fn(),
  isSameOriginMutation: (request: Request, baseUrl: string) =>
    request.headers.get("origin") === new URL(baseUrl).origin,
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

import { handleVideoPlaybackRequest } from "@/features/material-video/api/video-playback-route.server";

const materialId = "10000000-0000-4000-8000-000000000001";
const videoId = "20000000-0000-4000-8000-000000000001";

describe("Material Video playback BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getOptionalAccessToken.mockResolvedValue("optional-access-token");
  });

  it("rejects cross-origin capability issuance before identity or backend work", async () => {
    const response = await handleVideoPlaybackRequest(
      playbackRequest("https://attacker.example.test"),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fakes.getOptionalAccessToken).not.toHaveBeenCalled();
    expect(fakes.requestPlayback).not.toHaveBeenCalled();
  });

  it("returns only the validated private session after the backend access decision", async () => {
    fakes.requestPlayback.mockResolvedValue({
      body: {
        drmAuthToken: null,
        embedLocator: "https://kinescope.io/embed/provider-video",
        progressScope: "anonymous",
        resumeSeconds: null,
        videoId,
      },
      ok: true,
      response: Response.json({}),
    });

    const response = await handleVideoPlaybackRequest(
      playbackRequest("https://inside.example.test"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      drmAuthToken: null,
      videoId,
    });
    expect(fakes.requestPlayback).toHaveBeenCalledWith(
      materialId,
      videoId,
      "optional-access-token",
    );
  });

  it("preserves fail-closed backend status without returning provider facts", async () => {
    fakes.requestPlayback.mockResolvedValue({
      ok: false,
      problem: { code: "access_denied" },
      response: Response.json({}, { status: 403 }),
    });

    const response = await handleVideoPlaybackRequest(
      playbackRequest("https://inside.example.test"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "playback_unavailable" });
  });
});

function playbackRequest(origin: string): Request {
  const formData = new FormData();
  formData.set("materialId", materialId);
  formData.set("videoId", videoId);
  return new Request(
    "https://inside.example.test/api/material-video-playback",
    { body: formData, headers: { origin }, method: "POST" },
  );
}
