import { afterEach, describe, expect, it, vi } from "vitest";

import { reconcileMaterialVideo } from "@/features/material-video/api/video-authoring.browser";

const materialId = "10000000-0000-4000-8000-000000000001";
const videoId = "20000000-0000-4000-8000-000000000001";

describe("Material Video authoring browser contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
