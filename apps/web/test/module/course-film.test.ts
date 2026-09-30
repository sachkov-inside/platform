import { describe, expect, it } from "vitest";

import {
  FILM_DURATION,
  spring,
  track,
} from "@/features/ai-engineering-course/model/course-film";

describe("course film motion", () => {
  it("springs settle at the target and start from rest", () => {
    expect(spring(-1)).toBe(0);
    expect(spring(0)).toBe(0);
    expect(spring(3)).toBeCloseTo(1, 3);
  });

  it("tracks several targets without jumps and depends only on time", () => {
    const keys = [
      [0, 0],
      [1, 100],
      [2, 40],
    ] as const;
    expect(track(0.99, keys)).toBeCloseTo(0, 5);
    expect(track(5, keys)).toBeCloseTo(40, 2);
    // Детерминизм: один и тот же момент даёт один и тот же кадр.
    expect(track(1.37, keys)).toBe(track(1.37, keys));
    const step = Math.abs(track(1.5001, keys) - track(1.5, keys));
    expect(step).toBeLessThan(1);
  });

  it("loops within a fixed duration", () => {
    expect(FILM_DURATION).toBeGreaterThan(10);
  });
});
