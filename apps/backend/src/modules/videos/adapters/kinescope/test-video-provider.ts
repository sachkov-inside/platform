import { randomUUID } from "node:crypto";

import type { ProviderVideo, VideoProvider } from "../../ports/video-provider.js";

// Long enough for chapters of real authored recordings imported into a local runtime.
export const TEST_VIDEO_DURATION_SECONDS = 4 * 60 * 60;

export function createTestVideoProvider(): VideoProvider {
  const deleted = new Set<string>();
  const videos = new Map<string, ProviderVideo>();
  const findCounts = new Map<string, number>();
  const provider: VideoProvider = {
    delete(input) {
      if (deleted.has(input.id)) return Promise.resolve({ kind: "not_found" });
      deleted.add(input.id);
      videos.delete(input.id);
      return Promise.resolve({ kind: "deleted" });
    },
    initUpload(input) {
      const id = randomUUID();
      videos.set(id, {
        embedLocator: null,
        id,
        projectId: input.projectId,
        status: "processing",
        title: input.title,
      });
      return Promise.resolve({
        id,
        uploadEndpoint: `https://uploads.invalid/${id}`,
      });
    },
    find(input) {
      if (deleted.has(input.id)) return Promise.resolve(null);
      const findCount = (findCounts.get(input.id) ?? 0) + 1;
      findCounts.set(input.id, findCount);
      if (input.id.startsWith("test-outage-once-") && findCount === 1) {
        return Promise.reject(new Error("Test provider outage"));
      }
      const known = videos.get(input.id);
      if (known !== undefined) {
        if (known.status === "processing") {
          videos.set(input.id, {
            ...known,
            durationSeconds: known.durationSeconds ?? TEST_VIDEO_DURATION_SECONDS,
            embedLocator: `https://kinescope.io/embed/${input.id}`,
            status: "done",
          });
        }
        return Promise.resolve(known);
      }
      return Promise.resolve({
        durationSeconds: TEST_VIDEO_DURATION_SECONDS,
        embedLocator: `https://kinescope.io/embed/${input.id}`,
        id: input.id,
        projectId: input.projectId,
        status: "done",
        title: "Test video",
      });
    },
  };
  return Object.freeze(provider);
}
