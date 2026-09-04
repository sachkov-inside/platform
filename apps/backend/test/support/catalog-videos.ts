import type { Videos } from "../../src/modules/videos/index.js";

export const emptyCatalogVideos = {
  loadReadyDurations: () => Promise.resolve({ ok: true, value: [] }),
} satisfies Pick<Videos, "loadReadyDurations">;
