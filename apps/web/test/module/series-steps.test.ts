import { describe, expect, it } from "vitest";
import type { MaterialPreview } from "@/entities/material";
import { seriesSteps } from "@/_pages/library-discovery/model/series-steps";

function material(slug: string, stepGroup?: string): MaterialPreview {
  return { slug, title: slug, summary: "", access: "free", availability: "available", format: "Гайд", topic: "Release", topicSlug: "release", tags: [], seriesMemberships: [{ name: "Release", slug: "release", ordinal: 1, ...(stepGroup === undefined ? {} : { stepGroup }) }, { name: "Other", slug: "other", ordinal: 1 }] };
}

describe("Series step marks", () => {
  it("derives steps from explicit membership labels, across intervening entries and independent groups", () => {
    const items = [material("prepare", "Release"), material("video"), material("note", "Observe"), material("deploy", "Release")];
    expect([...seriesSteps(items, "release")]).toEqual([
      ["prepare", { label: "Release", ordinal: 1, total: 2 }],
      ["note", { label: "Observe", ordinal: 1, total: 1 }],
      ["deploy", { label: "Release", ordinal: 2, total: 2 }],
    ]);
    expect(seriesSteps(items, "other").size).toBe(0);
    const first = items[0];
    const last = items[3];
    if (first === undefined || last === undefined) throw new Error("Expected Materials");
    expect([...seriesSteps([last, first], "release").values()].map(({ ordinal }) => ordinal)).toEqual([1, 2]);
    expect([...seriesSteps([last], "release").values()]).toEqual([{ label: "Release", ordinal: 1, total: 1 }]);
  });
});
