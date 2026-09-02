import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getOptionalAccessToken: vi.fn(),
  requestAttach: vi.fn(),
  requestPlayback: vi.fn(),
  requestProgress: vi.fn(),
  requestReconcile: vi.fn(),
  requestUpload: vi.fn(),
}));

vi.mock("@/shared/api/backend/index.server", () => ({
  requestVideoAttach: fakes.requestAttach,
  requestVideoPlayback: fakes.requestPlayback,
  requestVideoProgress: fakes.requestProgress,
  requestVideoReconcile: fakes.requestReconcile,
  requestVideoUploadInit: fakes.requestUpload,
}));

vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.getAccessToken,
  LogtoSessionUnavailableError: class extends Error {},
}));

vi.mock("@/shared/auth/optional-platform-access-token.server", () => ({
  getOptionalPlatformAccessToken: fakes.getOptionalAccessToken,
}));

vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

vi.mock("@/shared/auth/same-origin-mutation.server", () => ({
  isSameOriginMutation: (request: Request, baseUrl: string) =>
    request.headers.get("origin") === new URL(baseUrl).origin,
}));

vi.mock("@/shared/auth/index.server", async () => {
  const handler = await import("@/shared/auth/authenticated-mutation-handler.server");
  return {
    handleAuthenticatedMutation: handler.handleAuthenticatedMutation,
    handleOptionalAuthenticatedMutation: handler.handleOptionalAuthenticatedMutation,
  };
});

import {
  handleVideoAttachmentRequest,
  handleVideoReconciliationRequest,
  handleVideoUploadRequest,
} from "@/features/material-video/api/video-authoring-route.server";
import {
  handleVideoPlaybackSessionRequest,
  handleVideoProgressSaveRequest,
} from "@/features/material-video/api/video-playback-route.server";
import { MAX_BROWSER_MUTATION_BYTES } from "@/shared/api/mutation-limits";

const materialId = "10000000-0000-4000-8000-000000000001";
const videoId = "20000000-0000-4000-8000-000000000001";

describe("Material Video playback BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getAccessToken.mockResolvedValue("access-token");
    fakes.getOptionalAccessToken.mockResolvedValue("optional-access-token");
  });

  it("rejects cross-origin capability issuance before identity or backend work", async () => {
    const response = await handleVideoPlaybackSessionRequest(
      playbackRequest("https://attacker.example.test"),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
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

    const response = await handleVideoPlaybackSessionRequest(
      playbackRequest("https://inside.example.test"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
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

  it("rejects an oversized optional-auth body before identity or backend work", async () => {
    const request = playbackRequest("https://inside.example.test");
    request.headers.set("content-length", String(MAX_BROWSER_MUTATION_BYTES + 1));

    const response = await handleVideoPlaybackSessionRequest(request);

    expect(response.status).toBe(413);
    expect(fakes.getOptionalAccessToken).not.toHaveBeenCalled();
    expect(fakes.requestPlayback).not.toHaveBeenCalled();
  });

  it("preserves fail-closed backend status without returning provider facts", async () => {
    fakes.requestPlayback.mockResolvedValue({
      ok: false,
      problem: { code: "access_denied" },
      response: Response.json({}, { status: 403 }),
    });

    const response = await handleVideoPlaybackSessionRequest(
      playbackRequest("https://inside.example.test"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "playback_unavailable" });
  });
});

describe("Material Video named authoring BFF mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getAccessToken.mockResolvedValue("access-token");
  });

  it("maps upload init through its exact capability request", async () => {
    fakes.requestUpload.mockResolvedValue({
      body: { uploadEndpoint: "https://uploads.invalid/video", video: { videoId } },
      ok: true,
      response: Response.json({}),
    });
    const response = await handleVideoUploadRequest(mutationRequest(
      "/api/authoring/material-video-uploads",
      {
        access: "free",
        byteSize: "1024",
        filename: "lesson.mp4",
        materialId,
        submissionId: "30000000-0000-4000-8000-000000000001",
        title: "Lesson",
      },
      "POST",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ kind: "ready" });
    expect(fakes.requestUpload).toHaveBeenCalledWith({
      access: "free",
      byteSize: 1024,
      filename: "lesson.mp4",
      idempotencyKey: "web-video-30000000-0000-4000-8000-000000000001",
      materialId,
      title: "Lesson",
    }, "access-token");
  });

  it("keeps attach and reconcile as separate literal mutations", async () => {
    fakes.requestAttach.mockResolvedValue({ body: { videoId }, ok: true, response: Response.json({}) });
    fakes.requestReconcile.mockResolvedValue({ body: { state: "ready", videoId }, ok: true, response: Response.json({}) });

    const attached = await handleVideoAttachmentRequest(mutationRequest(
      "/api/authoring/material-video-attachments",
      { access: "membership", materialId, providerVideoId: "provider-video" },
      "POST",
    ));
    const reconciled = await handleVideoReconciliationRequest(mutationRequest(
      "/api/authoring/material-video-reconciliations",
      { videoId },
      "POST",
    ));

    await expect(attached.json()).resolves.toMatchObject({ kind: "ready" });
    await expect(reconciled.json()).resolves.toMatchObject({ kind: "ready" });
    expect(fakes.requestAttach).toHaveBeenCalledWith({
      access: "membership",
      materialId,
      providerVideoId: "provider-video",
    }, "access-token");
    expect(fakes.requestReconcile).toHaveBeenCalledWith(videoId, "access-token");
  });

  it("saves progress through the authenticated PUT capability", async () => {
    fakes.requestProgress.mockResolvedValue({ ok: true, response: new Response(null, { status: 204 }) });
    const response = await handleVideoProgressSaveRequest(mutationRequest(
      "/api/material-video-progress",
      { durationSeconds: "120", materialId, positionSeconds: "37", videoId },
      "PUT",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: "saved" });
    expect(fakes.requestProgress).toHaveBeenCalledWith({
      durationSeconds: 120,
      materialId,
      positionSeconds: 37,
      videoId,
    }, "access-token");
  });
});

function playbackRequest(origin: string): Request {
  const formData = new FormData();
  formData.set("materialId", materialId);
  formData.set("videoId", videoId);
  return new Request(
    "https://inside.example.test/api/material-video-playback-sessions",
    { body: formData, headers: { origin }, method: "POST" },
  );
}

function mutationRequest(
  path: string,
  fields: Readonly<Record<string, string>>,
  method: "POST" | "PUT",
): Request {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return new Request(`https://inside.example.test${path}`, {
    body: formData,
    headers: { origin: "https://inside.example.test" },
    method,
  });
}
