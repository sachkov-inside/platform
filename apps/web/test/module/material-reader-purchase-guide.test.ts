import { describe, expect, it } from "vitest";

import { soleSoldGuide } from "@/_pages/material-reader/model/purchase-guide";

describe("продукт, к которому зовёт закрытый материал", () => {
  it("ведёт к единственному продаваемому продукту среди продуктов материала", () => {
    expect(soleSoldGuide([{ slug: "ai-first", sold: true }])).toBe("ai-first");
    expect(soleSoldGuide([{ slug: "archive", sold: false }, { slug: "ai-first", sold: true }])).toBe("ai-first");
  });

  it("не выбирает наугад и не зовёт туда, где купить нечего", () => {
    expect(soleSoldGuide([{ slug: "ai-first", sold: true }, { slug: "platform", sold: true }])).toBeUndefined();
    expect(soleSoldGuide([{ slug: "archive", sold: false }])).toBeUndefined();
    expect(soleSoldGuide([])).toBeUndefined();
  });
});
