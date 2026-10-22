import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachMaterialVideo,
  initMaterialVideoUpload,
  reconcileMaterialVideo,
} from "@/features/material-video/api/video-authoring.browser";

const materialId = "10000000-0000-4000-8000-000000000001";
const videoId = "20000000-0000-4000-8000-000000000001";

describe("Material Video authoring browser contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["upload_not_authorized", "upload_outcome_unknown"])(
    "preserves %s instead of suggesting a generic retry",
    async (kind) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ kind })),
      );
      expect(
        await initMaterialVideoUpload({
          access: "free",
          byteSize: 42,
          filename: "video.mp4",
          materialId,
          submissionId: videoId,
          title: "Video",
        }),
      ).toEqual({ kind });
    },
  );

  it("accepts the upload response the backend sends with the provider Video id", async () => {
    // Since #669 the backend returns providerVideoId next to the upload endpoint.
    const video = {
      access: "free",
      materialId,
      origin: "platform_upload",
      state: "uploading",
      title: "Video",
      videoId,
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          kind: "ready",
          value: {
            providerVideoId: "kinescope-1",
            uploadEndpoint: "https://uploader.example.test/v2/upload",
            video,
          },
        }),
      ),
    );
    await expect(
      initMaterialVideoUpload({
        access: "free",
        byteSize: 42,
        filename: "video.mp4",
        materialId,
        submissionId: videoId,
        title: "Video",
      }),
    ).resolves.toMatchObject({
      kind: "ready",
      value: { uploadEndpoint: "https://uploader.example.test/v2/upload" },
    });
  });

  it("accepts the ready Video duration returned by reconciliation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          kind: "ready",
          value: {
            access: "free",
            durationSeconds: 600,
            materialId,
            origin: "platform_upload",
            state: "ready",
            title: "Ready video",
            videoId,
          },
        }),
      ),
    );

    await expect(reconcileMaterialVideo({ videoId })).resolves.toEqual({
      kind: "ready",
      value: {
        access: "free",
        durationSeconds: 600,
        materialId,
        origin: "platform_upload",
        state: "ready",
        title: "Ready video",
        videoId,
      },
    });
  });

  it("sends the attachment as JSON and reads a refused or malformed answer as unavailable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ kind: "unauthorized" }))
      .mockResolvedValueOnce(
        Response.json({ kind: "ready", value: { videoId } }),
      );
    vi.stubGlobal("fetch", fetch);
    const input = {
      access: "closed",
      materialId,
      providerVideoId: "provider-video",
    } as const;

    await expect(attachMaterialVideo(input)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(attachMaterialVideo(input)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/authoring/material-video-attachments",
      expect.objectContaining({
        body: JSON.stringify(input),
        method: "POST",
      }),
    );
  });
});
