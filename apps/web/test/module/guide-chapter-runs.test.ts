import { describe, expect, it } from "vitest";

import { guideChapterRuns } from "@/shared/lib/guide-chapter-runs";

const chapters = [
  { id: "alpha" },
  { id: "beta" },
  { id: "gamma" },
] as const;

function shape(items: readonly { readonly id: string; readonly chapter: string | null }[]) {
  return guideChapterRuns(items, chapters, (item) => item.chapter).map((run) => ({
    chapter: run.chapter?.id ?? null,
    items: run.items.map(({ id }) => id),
    offset: run.offset,
  }));
}

describe("Guide chapter runs", () => {
  it("keeps Materials outside every chapter where the author left them", () => {
    expect(
      shape([
        { id: "one", chapter: "alpha" },
        { id: "two", chapter: null },
        { id: "three", chapter: "beta" },
      ]),
    ).toEqual([
      { chapter: "alpha", items: ["one"], offset: 0 },
      { chapter: null, items: ["two"], offset: 1 },
      { chapter: "beta", items: ["three"], offset: 2 },
      { chapter: "gamma", items: [], offset: 3 },
    ]);
  });

  it("places a chapter that holds nothing after the last preceding chapter that does", () => {
    expect(
      shape([
        { id: "one", chapter: "alpha" },
        { id: "two", chapter: "gamma" },
      ]),
    ).toEqual([
      { chapter: "alpha", items: ["one"], offset: 0 },
      { chapter: "beta", items: [], offset: 1 },
      { chapter: "gamma", items: ["two"], offset: 1 },
    ]);
  });

  it("puts a trailing empty chapter after the whole composition", () => {
    expect(shape([{ id: "one", chapter: "alpha" }])).toEqual([
      { chapter: "alpha", items: ["one"], offset: 0 },
      { chapter: "beta", items: [], offset: 1 },
      { chapter: "gamma", items: [], offset: 1 },
    ]);
  });

  it("returns one ungrouped run for a Guide without chapters", () => {
    expect(
      guideChapterRuns(
        [{ id: "one" }, { id: "two" }],
        [],
        () => null,
      ),
    ).toEqual([{ chapter: null, items: [{ id: "one" }, { id: "two" }], offset: 0 }]);
  });
});
