import { describe, expect, it, vi } from "vitest";

import {
  fillGuidePage,
  fillGuidePageHero,
  readGuidePageHero,
  type GuidePage,
} from "@/entities/guide-page";

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

describe("offer terms in a product description", () => {
  const fill = (text: string) => text.replaceAll("{support_term}", "год");

  it("fills every text of every block kind", () => {
    const page: GuidePage = {
      card: null,
      blocks: [
        {
          id: "hero",
          kind: "hero",
          badge: "{support_term}",
          lead: "{support_term}",
          highlights: ["{support_term}"],
        },
        {
          id: "cards",
          kind: "cards",
          eyebrow: "{support_term}",
          title: "{support_term}",
          lead: "{support_term}",
          note: "{support_term}",
          items: [
            {
              title: "{support_term}",
              text: "{support_term}",
              detailLabel: "{support_term}",
              detail: "{support_term}",
            },
          ],
        },
        {
          id: "text",
          kind: "text",
          title: "{support_term}",
          paragraphs: ["{support_term}"],
        },
        {
          id: "steps",
          kind: "steps",
          title: "{support_term}",
          lead: "{support_term}",
          link: "{support_term}",
          items: [{ title: "{support_term}", text: "{support_term}" }],
        },
        {
          id: "list",
          kind: "list",
          title: "{support_term}",
          text: "{support_term}",
          items: ["{support_term}"],
        },
        {
          id: "trial",
          kind: "trial",
          title: "{support_term}",
          text: "{support_term}",
          link: "{support_term}",
        },
      ],
    };
    expect(JSON.stringify(fillGuidePage(page, fill))).not.toContain(
      "{support_term}",
    );
  });

  it("fills the Home hero the same way", () => {
    expect(
      fillGuidePageHero(
        {
          badge: "",
          lead: "Поддержка {support_term}",
          highlights: ["{support_term}"],
        },
        fill,
      ),
    ).toEqual({ badge: "", lead: "Поддержка год", highlights: ["год"] });
  });
});
