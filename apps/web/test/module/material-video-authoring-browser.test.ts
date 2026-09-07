import { afterEach, describe, expect, it, vi } from "vitest";

import { initMaterialVideoUpload, reconcileMaterialVideo } from "@/features/material-video/api/video-authoring.browser";

const materialId = "10000000-0000-4000-8000-000000000001";
const videoId = "20000000-0000-4000-8000-000000000001";

describe("Material Video authoring browser contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["upload_not_authorized", "upload_outcome_unknown"])("preserves %s instead of suggesting a generic retry", async (kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ kind })));
    expect(await initMaterialVideoUpload({ access: "free", byteSize: 42, filename: "video.mp4", materialId, submissionId: videoId, title: "Video" })).toEqual({ kind });
  });

  it("accepts the ready Video duration returned by reconciliation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
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
    })));

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
});
