import { describe, expect, test } from "vitest";

import { guideChapterPlacementIssues } from "../../src/modules/materials/features/reorder-series/guide-chapter-placement.js";

const [alpha, beta, gamma] = ["alpha", "beta", "gamma"];
const [one, two, three, four] = ["one", "two", "three", "four"];

describe("Guide chapter placement", () => {
  test("accepts a flat Guide, a fully grouped Guide and unassigned Materials between chapters", () => {
    expect(guideChapterPlacementIssues([one, two], {}, [])).toEqual([]);
    expect(
      guideChapterPlacementIssues([one, two, three], { [one]: alpha, [two]: alpha, [three]: beta }, [
        alpha,
        beta,
      ]),
    ).toEqual([]);
    expect(
      guideChapterPlacementIssues([one, two, three], { [one]: alpha, [three]: beta }, [alpha, beta]),
    ).toEqual([]);
  });

  test("accepts a declared chapter that holds no Material anywhere in the list", () => {
    expect(
      guideChapterPlacementIssues([one, two], { [one]: alpha, [two]: gamma }, [alpha, beta, gamma]),
    ).toEqual([]);
  });

  test("rejects a chapter split by another chapter or by an unassigned Material", () => {
    expect(
      guideChapterPlacementIssues([one, two, three], { [one]: alpha, [two]: beta, [three]: alpha }, [
        alpha,
        beta,
      ]),
    ).toEqual([{ code: "guide_chapter_not_continuous", path: "/orderedMaterialIds/2" }]);
    expect(
      guideChapterPlacementIssues([one, two, three], { [one]: alpha, [three]: alpha }, [alpha]),
    ).toEqual([{ code: "guide_chapter_not_continuous", path: "/orderedMaterialIds/2" }]);
  });

  test("rejects chapters whose runs contradict the declared chapter order", () => {
    expect(
      guideChapterPlacementIssues(
        [one, two, three, four],
        { [one]: gamma, [two]: gamma, [three]: alpha, [four]: alpha },
        [alpha, beta, gamma],
      ),
    ).toEqual([{ code: "guide_chapter_out_of_order", path: "/chapters/2" }]);
  });
});
