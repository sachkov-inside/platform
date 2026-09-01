import { describe, expect, test } from "vitest";

import { createTestVideoProvider } from "../../src/modules/videos/adapters/kinescope/test-video-provider.js";

describe("Kinescope test Video provider", () => {
  test("models one processing observation before an upload becomes ready", async () => {
    const provider = createTestVideoProvider();
    const initialized = await provider.initUpload({
      access: "free",
      byteSize: 1_024,
      filename: "lesson.mp4",
      projectId: "public-project",
      title: "Lesson",
    });

    await expect(provider.find({ id: initialized.id, projectId: "public-project" }))
      .resolves.toMatchObject({ embedLocator: null, status: "processing" });
    await expect(provider.find({ id: initialized.id, projectId: "public-project" }))
      .resolves.toMatchObject({
        embedLocator: `https://kinescope.io/embed/${initialized.id}`,
        status: "done",
      });
  });

  test("models a recoverable first lookup outage for its explicit fixture prefix", async () => {
    const provider = createTestVideoProvider();
    const input = { id: "test-outage-once-video", projectId: "public-project" };

    await expect(provider.find(input)).rejects.toThrow("Test provider outage");
    await expect(provider.find(input)).resolves.toMatchObject({
      id: input.id,
      projectId: input.projectId,
      status: "done",
    });
  });
});
