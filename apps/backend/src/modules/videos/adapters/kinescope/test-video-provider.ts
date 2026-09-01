import { randomUUID } from "node:crypto";

import type { ProviderVideo, VideoProvider } from "../../ports/video-provider.js";

export function createTestVideoProvider(): VideoProvider {
  const videos = new Map<string, ProviderVideo>();
  const provider: VideoProvider = {
    initUpload(input) {
      const id = randomUUID();
      videos.set(id, {
        embedLocator: `https://kinescope.io/embed/${id}`,
        id,
        projectId: input.projectId,
        status: "done",
        title: input.title,
      });
      return Promise.resolve({
        id,
        uploadEndpoint: `https://uploads.invalid/${id}`,
      });
    },
    find(input) {
      const known = videos.get(input.id);
      if (known !== undefined) return Promise.resolve(known);
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
