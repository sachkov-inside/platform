import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readPlaybackPreferences,
  savePlaybackPreferences,
} from "@/features/material-video/model/playback-preferences.browser";

describe("browser video preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function storage(initial: string | null = null) {
    let value = initial;
    vi.stubGlobal("localStorage", {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    });
  }

  it("keeps zero volume and mute when speed changes", () => {
    storage();
    savePlaybackPreferences({ volume: 0, muted: true });
    savePlaybackPreferences({ playbackRate: 2 });
    expect(readPlaybackPreferences()).toEqual({
      version: 1,
      volume: 0,
      muted: true,
      playbackRate: 2,
    });
  });

  it.each([
    "broken json",
    '{"version":1,"volume":4}',
    '{"version":2,"playbackRate":2}',
  ])("ignores unusable saved preferences: %s", (value) => {
    storage(value);
    expect(readPlaybackPreferences()).toEqual({ version: 1 });
    savePlaybackPreferences({ playbackRate: 1.5 });
    expect(readPlaybackPreferences()).toEqual({
      version: 1,
      playbackRate: 1.5,
    });
  });

  it("keeps valid settings when the provider reports an invalid value", () => {
    storage();
    savePlaybackPreferences({ volume: 0.35, playbackRate: 1.75 });
    savePlaybackPreferences({ playbackRate: NaN });
    expect(readPlaybackPreferences()).toEqual({
      version: 1,
      volume: 0.35,
      playbackRate: 1.75,
    });
  });

  it("allows playback to proceed when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage blocked");
      },
      setItem: () => {
        throw new Error("Storage full");
      },
    });
    expect(readPlaybackPreferences()).toEqual({ version: 1 });
    expect(() => {
      savePlaybackPreferences({ volume: 0.5 });
    }).not.toThrow();
  });
});
