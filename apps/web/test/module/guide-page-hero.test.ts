import { describe, expect, it, vi } from "vitest";

import { readGuidePageHero } from "@/entities/guide-page";

describe("Home hero of a product", () => {
  it("reads the product's first screen and fills a missing badge", () => {
    expect(
      readGuidePageHero(
        { lead: "Освой AI", highlights: ["Гайды"] },
        "test",
        vi.fn(),
      ),
    ).toEqual({ badge: "", lead: "Освой AI", highlights: ["Гайды"] });
  });

  it("shows nothing and warns when the stored hero is newer than the site", () => {
    const warn = vi.fn();
    expect(readGuidePageHero({ lead: 1 }, "test", warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(readGuidePageHero(null, "test", warn)).toBeNull();
  });
});
