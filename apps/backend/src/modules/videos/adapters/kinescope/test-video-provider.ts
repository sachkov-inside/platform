import { randomUUID } from "node:crypto";

import type { ProviderVideo, VideoProvider } from "../../ports/video-provider.js";

export function createTestVideoProvider(): VideoProvider {
  const videos = new Map<string, ProviderVideo>();
  const findCounts = new Map<string, number>();
  const provider: VideoProvider = {
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
            embedLocator: `https://kinescope.io/embed/${input.id}`,
            status: "done",
          });
        }
        return Promise.resolve(known);
      }
      return Promise.resolve({
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
