import { describe, expect, it } from "vitest";

import { soleSoldProduct } from "@/_pages/material-reader/model/purchase-product";

describe("продукт, к которому зовёт закрытый материал", () => {
  it("ведёт к единственному продаваемому продукту среди продуктов материала", () => {
    expect(soleSoldProduct([{ slug: "ai-first", sold: true }])).toBe(
      "ai-first",
    );
    expect(
      soleSoldProduct([
        { slug: "archive", sold: false },
        { slug: "ai-first", sold: true },
      ]),
    ).toBe("ai-first");
  });

  it("не выбирает наугад и не зовёт туда, где купить нечего", () => {
    expect(
      soleSoldProduct([
        { slug: "ai-first", sold: true },
        { slug: "platform", sold: true },
      ]),
    ).toBeUndefined();
    expect(soleSoldProduct([{ slug: "archive", sold: false }])).toBeUndefined();
    expect(soleSoldProduct([])).toBeUndefined();
  });
});
