import { describe, expect, it } from "vitest";

import { resolveVideoPlaybackProgress } from "@/features/material-video/model/video";

describe("Material video playback progress", () => {
  it("resumes an unfinished video from its saved position", () => {
    expect(resolveVideoPlaybackProgress(37, 120)).toEqual({
      resumeSeconds: 37,
      watched: false,
    });
  });

  it("restarts a watched video instead of seeking to its end", () => {
    expect(resolveVideoPlaybackProgress(120, 120)).toEqual({
      resumeSeconds: 0,
      watched: true,
    });
    expect(resolveVideoPlaybackProgress(115, 120)).toEqual({
      resumeSeconds: 0,
      watched: true,
    });
  });

  it("keeps a new video at the beginning without marking it watched", () => {
    expect(resolveVideoPlaybackProgress(null, 120)).toEqual({
      resumeSeconds: null,
      watched: false,
    });
  });
});
