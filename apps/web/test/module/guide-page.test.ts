import { describe, expect, test, vi } from "vitest";

import { fillOfferTerms, readGuideProductPage, resolveGuidePresentation } from "@/entities/guide-page";
import { aiFirstProductPage } from "@/workshop/guide-page.fixtures";

describe("Guide product page", () => {
  test("keeps a description this site can draw", () => {
    const warn = vi.fn();
    expect(readGuideProductPage({ presentation: "ai-first-process", page: aiFirstProductPage }, "Guide x", warn)).toEqual({
      presentation: "ai-first-process",
      page: aiFirstProductPage,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test("falls back to the default template for a presentation it does not know", () => {
    const warn = vi.fn();
    expect(resolveGuidePresentation("neon-hero", "Guide x", warn)).toBe("default");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown presentation "neon-hero"'));
  });

  test("shows no description when the stored one does not match this site", () => {
    const warn = vi.fn();
    const result = readGuideProductPage(
      { presentation: "ai-first-process", page: { card: null, blocks: [{ id: "hero", kind: "poster" }] } },
      "Guide x",
      warn,
    );
    expect(result).toEqual({ presentation: "ai-first-process", page: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("does not match this site"));
    expect(readGuideProductPage({ presentation: "default", page: null }, "Guide x", () => {})).toEqual({
      presentation: "default",
      page: null,
    });
  });

  test("substitutes only the offer terms the author may write", () => {
    const terms = { access: "2 года", support: "6 месяцев" };
    expect(fillOfferTerms("Доступ — {access_term}, помощь — {support_term}.", terms)).toBe("Доступ — 2 года, помощь — 6 месяцев.");
    expect(fillOfferTerms("Цена {price}", terms)).toBe("Цена {price}");
  });
});
