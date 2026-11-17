import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "@/shared/auth/index.server";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleVideoAttachmentRequest as realHandleVideoAttachmentRequest,
  handleVideoDeletionRetryRequest as realHandleVideoDeletionRetryRequest,
  handleVideoReconciliationRequest as realHandleVideoReconciliationRequest,
  handleVideoUploadRequest as realHandleVideoUploadRequest,
} from "@/features/material-video/api/video-authoring-route.server";
import {
  handleVideoPlaybackSessionRequest as realHandleVideoPlaybackSessionRequest,
  handleVideoProgressSaveRequest as realHandleVideoProgressSaveRequest,
} from "@/features/material-video/api/video-playback-route.server";

const handleVideoAttachmentRequest = (
  ...args: Parameters<typeof realHandleVideoAttachmentRequest>
) => session(() => realHandleVideoAttachmentRequest(...args));
const handleVideoDeletionRetryRequest = (
  ...args: Parameters<typeof realHandleVideoDeletionRetryRequest>
) => session(() => realHandleVideoDeletionRetryRequest(...args));
const handleVideoReconciliationRequest = (
  ...args: Parameters<typeof realHandleVideoReconciliationRequest>
) => session(() => realHandleVideoReconciliationRequest(...args));
const handleVideoUploadRequest = (
  ...args: Parameters<typeof realHandleVideoUploadRequest>
) => session(() => realHandleVideoUploadRequest(...args));
const handleVideoPlaybackSessionRequest = (
  ...args: Parameters<typeof realHandleVideoPlaybackSessionRequest>
) => session(() => realHandleVideoPlaybackSessionRequest(...args));
const handleVideoProgressSaveRequest = (
  ...args: Parameters<typeof realHandleVideoProgressSaveRequest>
) => session(() => realHandleVideoProgressSaveRequest(...args));

const materialId = "10000000-0000-4000-8000-000000000001";
const videoId = "20000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession();
  interceptBackendHttp(backend);
});
afterEach(() => vi.useRealTimers());

describe("Material Video playback BFF", () => {
  it("allows guest playback without a Bearer and requires identity for saving progress", async () => {
    session = await realBffSession(null);
    backend.mockResolvedValueOnce(
      Response.json({
        drmAuthToken: null,
        embedLocator: "https://kinescope.io/embed/provider-video",
        progressScope: "anonymous",
        resumeSeconds: null,
        videoId,
      }),
    );
    const playback = await handleVideoPlaybackSessionRequest(
      playbackRequest("https://inside.example.test"),
    );
    expect(playback.status).toBe(200);
    expect(await playback.json()).toEqual({
      drmAuthToken: null,
      embedLocator: "https://kinescope.io/embed/provider-video",
      progressScope: "anonymous",
      resumeSeconds: null,
      videoId: "20000000-0000-4000-8000-000000000001",
    });
    expectSingleBackendRequest(
      backend,
      "POST",
      `/materials/${materialId}/videos/${videoId}/playback`,
      null,
    );
    backend.mockClear();
    const progress = await handleVideoProgressSaveRequest(
      operationRequest(
        "/api/material-video-progress",
        { durationSeconds: 120, materialId, positionSeconds: 37, videoId },
        "PUT",
      ),
    );
    expect(progress.status).toBe(401);
    expect(backend).not.toHaveBeenCalled();
  });

  it("rejects cross-origin capability issuance before identity or backend work", async () => {
    const tokenReads = vi.spyOn(auth, "getOptionalPlatformAccessToken");
    const response = await handleVideoPlaybackSessionRequest(
      playbackRequest("https://attacker.example.test"),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(tokenReads).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });

  it("returns only the validated private session after the backend access decision", async () => {
    backend.mockResolvedValueOnce(
      Response.json(
        {
          drmAuthToken: null,
          embedLocator: "https://kinescope.io/embed/provider-video",
          progressScope: "anonymous",
          resumeSeconds: null,
          videoId,
        },
        { status: 200 },
      ),
    );

    const response = await handleVideoPlaybackSessionRequest(
      playbackRequest("https://inside.example.test"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toMatchObject({
      drmAuthToken: null,
      videoId,
    });
    expect(
      expectSingleBackendRequest(
        backend,
        "POST",
        `/materials/${materialId}/videos/${videoId}/playback`,
      ).body,
    ).toBeNull();
  });

  it("asks for an author preview session only when the preview page says so", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ code: "access_denied" }, { status: 403 }),
    );

    await handleVideoPlaybackSessionRequest(
      playbackRequest("https://inside.example.test", true),
    );
    expect(
      expectSingleBackendRequest(
        backend,
        "POST",
        `/materials/${materialId}/videos/${videoId}/playback?preview=true`,
      ).body,
    ).toBeNull();

    const response = await handleVideoPlaybackSessionRequest(
      playbackRequest("https://inside.example.test", "yes"),
    );
    expect(response.status).toBe(404);
    expect(backend).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized optional-auth body before identity or backend work", async () => {
    const tokenReads = vi.spyOn(auth, "getOptionalPlatformAccessToken");
    const request = playbackRequest("https://inside.example.test");
    request.headers.set("content-length", "2097153");

    const response = await handleVideoPlaybackSessionRequest(request);

    expect(response.status).toBe(413);
    expect(tokenReads).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });

  it("preserves fail-closed backend status without returning provider facts", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ code: "access_denied" }, { status: 403 }),
    );

    const response = await handleVideoPlaybackSessionRequest(
      playbackRequest("https://inside.example.test"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "playback_unavailable",
    });
  });
});

describe("Material Video named authoring BFF mutations", () => {
  it.each(["upload_not_authorized", "upload_outcome_unknown"])(
    "preserves the known upload failure %s without provider details",
    async (code) => {
      backend.mockResolvedValueOnce(
        Response.json({ code, secret: "provider-detail" }, { status: 503 }),
      );
      const response = await handleVideoUploadRequest(
        operationRequest(
          "/api/authoring/material-video-uploads",
          {
            access: "free",
            byteSize: 42,
            filename: "video.mp4",
            materialId,
            submissionId: videoId,
            title: "Video",
          },
          "POST",
        ),
      );
      expect(await response.json()).toEqual({ kind: code });
    },
  );

  it("maps upload init through its exact capability request", async () => {
    backend.mockResolvedValueOnce(
      Response.json(
        {
          uploadEndpoint: "https://uploads.invalid/video",
          video: { videoId },
        },
        { status: 201 },
      ),
    );
    const response = await handleVideoUploadRequest(
      operationRequest(
        "/api/authoring/material-video-uploads",
        {
          access: "free",
          byteSize: 1024,
          filename: "lesson.mp4",
          materialId,
          submissionId: "30000000-0000-4000-8000-000000000001",
          title: "Lesson",
        },
        "POST",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ kind: "ready" });
    const outgoing = expectSingleBackendRequest(
      backend,
      "POST",
      `/authoring/materials/${materialId}/videos/uploads`,
    );
    expect(outgoing.headers.get("idempotency-key")).toBe(
      "web-video-30000000-0000-4000-8000-000000000001",
    );
    expect(await outgoing.json()).toEqual({
      access: "free",
      byteSize: 1024,
      filename: "lesson.mp4",
      title: "Lesson",
    });
  });

  it("keeps attach and reconcile as separate literal mutations", async () => {
    backend.mockResolvedValueOnce(Response.json({ videoId }, { status: 201 }));
    backend.mockResolvedValueOnce(
      Response.json({ state: "ready", videoId }, { status: 200 }),
    );

    const attached = await handleVideoAttachmentRequest(
      operationRequest(
        "/api/authoring/material-video-attachments",
        { access: "closed", materialId, providerVideoId: "provider-video" },
        "POST",
      ),
    );
    const reconciled = await handleVideoReconciliationRequest(
      operationRequest(
        "/api/authoring/material-video-reconciliations",
        { videoId },
        "POST",
      ),
    );

    await expect(attached.json()).resolves.toMatchObject({ kind: "ready" });
    await expect(reconciled.json()).resolves.toMatchObject({ kind: "ready" });
    expect(backend).toHaveBeenCalledTimes(2);
    const attachedRequest = backend.mock.calls[0]?.[0];
    const reconciledRequest = backend.mock.calls[1]?.[0];
    expect(attachedRequest?.method).toBe("POST");
    expect(attachedRequest?.url).toBe(
      `https://platform-api.example.test/authoring/materials/${materialId}/videos/attach`,
    );
    expect(attachedRequest?.headers.get("authorization")).toBe(
      "Bearer trusted-token",
    );
    expect(await attachedRequest?.json()).toEqual({
      access: "closed",
      providerVideoId: "provider-video",
    });
    expect(reconciledRequest?.method).toBe("POST");
    expect(reconciledRequest?.url).toBe(
      `https://platform-api.example.test/authoring/videos/${videoId}/reconcile`,
    );
    expect(reconciledRequest?.headers.get("authorization")).toBe(
      "Bearer trusted-token",
    );
    expect(reconciledRequest?.body).toBeNull();
  });

  it("retries a failed deletion through its named mutation", async () => {
    backend.mockResolvedValueOnce(
      Response.json({ state: "deletion_requested", videoId }, { status: 200 }),
    );

    const response = await handleVideoDeletionRetryRequest(
      operationRequest(
        "/api/authoring/material-video-deletion-retries",
        { videoId },
        "POST",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({ kind: "ready" });
    expect(
      expectSingleBackendRequest(
        backend,
        "POST",
        `/authoring/videos/${videoId}/deletion-retries`,
      ).body,
    ).toBeNull();
  });

  it("refuses an upload body with an unknown field before any backend call", async () => {
    const response = await handleVideoUploadRequest(
      operationRequest(
        "/api/authoring/material-video-uploads",
        {
          access: "free",
          byteSize: 42,
          filename: "video.mp4",
          materialId,
          submissionId: videoId,
          title: "Video",
          unexpected: true,
        },
        "POST",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: "invalid_input" });
    expect(backend).not.toHaveBeenCalled();
  });

  it("saves progress through the authenticated PUT capability", async () => {
    backend.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const response = await handleVideoProgressSaveRequest(
      operationRequest(
        "/api/material-video-progress",
        { durationSeconds: 120, materialId, positionSeconds: 37, videoId },
        "PUT",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: "saved" });
    expect(
      await expectSingleBackendRequest(
        backend,
        "PUT",
        `/materials/${materialId}/videos/${videoId}/progress`,
      ).json(),
    ).toEqual({ durationSeconds: 120, positionSeconds: 37 });
  });
});

function playbackRequest(origin: string, preview?: unknown): Request {
  return new Request(
    "https://inside.example.test/api/material-video-playback-sessions",
    {
      body: JSON.stringify({ materialId, videoId, preview }),
      headers: {
        "content-type": "application/json",
        origin,
        ...(session.cookieHeader === null
          ? {}
          : { cookie: session.cookieHeader }),
      },
      method: "POST",
    },
  );
}

function operationRequest(
  path: string,
  input: Readonly<Record<string, unknown>>,
  method: "POST" | "PUT",
): Request {
  return new Request(`https://inside.example.test${path}`, {
    body: JSON.stringify(input),
    headers: {
      "content-type": "application/json",
      origin: "https://inside.example.test",
    },
    method,
  });
}
