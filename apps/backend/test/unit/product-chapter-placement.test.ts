import { describe, expect, test } from "vitest";

import { productChapterPlacementIssues } from "../../src/modules/materials/features/reorder-series/product-chapter-placement.js";

const [alpha, beta, gamma] = ["alpha", "beta", "gamma"];
const [one, two, three, four] = ["one", "two", "three", "four"];

describe("Product chapter placement", () => {
  test("accepts a flat Product, a fully grouped Product and unassigned Materials between chapters", () => {
    expect(productChapterPlacementIssues([one, two], {}, [])).toEqual([]);
    expect(
      productChapterPlacementIssues(
        [one, two, three],
        { [one]: alpha, [two]: alpha, [three]: beta },
        [alpha, beta],
      ),
    ).toEqual([]);
    expect(
      productChapterPlacementIssues(
        [one, two, three],
        { [one]: alpha, [three]: beta },
        [alpha, beta],
      ),
    ).toEqual([]);
  });

  test("accepts a declared chapter that holds no Material anywhere in the list", () => {
    expect(
      productChapterPlacementIssues(
        [one, two],
        { [one]: alpha, [two]: gamma },
        [alpha, beta, gamma],
      ),
    ).toEqual([]);
  });

  test("rejects a chapter split by another chapter or by an unassigned Material", () => {
    expect(
      productChapterPlacementIssues(
        [one, two, three],
        { [one]: alpha, [two]: beta, [three]: alpha },
        [alpha, beta],
      ),
    ).toEqual([
      { code: "product_chapter_not_continuous", path: "/orderedMaterialIds/2" },
    ]);
    expect(
      productChapterPlacementIssues(
        [one, two, three],
        { [one]: alpha, [three]: alpha },
        [alpha],
      ),
    ).toEqual([
      { code: "product_chapter_not_continuous", path: "/orderedMaterialIds/2" },
    ]);
  });

  test("rejects chapters whose runs contradict the declared chapter order", () => {
    expect(
      productChapterPlacementIssues(
        [one, two, three, four],
        { [one]: gamma, [two]: gamma, [three]: alpha, [four]: alpha },
        [alpha, beta, gamma],
      ),
    ).toEqual([{ code: "product_chapter_out_of_order", path: "/chapters/2" }]);
  });
});
