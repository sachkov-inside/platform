import { describe, expect, it } from "vitest";

import { readVideoTimeFragment, resolveVideoStartPosition, resolveVideoPlaybackProgress } from "@/features/material-video/model/video";

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


describe("explicit video time links", () => {
  it("gives explicit zero and an early chapter precedence over saved progress", () => {
    expect(resolveVideoStartPosition(90, 120, "#t=0")).toBe(0);
    expect(resolveVideoStartPosition(90, 120, "#t=3")).toBe(3);
    expect(resolveVideoStartPosition(120, 120, "#t=37")).toBe(37);
  });
  it.each(["", "#heading", "#t=", "#t=-1", "#t=120", "#t=999999999999999999999", "#t=3.5", "#t=1e1", "#t=1&t=2"])("ignores invalid or out-of-range fragment %s", fragment => {
    expect(readVideoTimeFragment(fragment, 120)).toBeNull();
    expect(resolveVideoStartPosition(90, 120, fragment)).toBe(90);
  });
});
