import { describe, expect, it } from "vitest";

import { courseLessonAction } from "@/_pages/material-reader/model/purchase-product";
import { internalRoute } from "@/shared/routing/internal-route";

const courseHref = internalRoute("/products/ai-engineering");
const buyHref = internalRoute("/products/ai-engineering/buy");
const sold = { kind: "product", href: buyHref } as const;

describe("урок курса ведёт того, кому курс не открыт", () => {
  it("на оплату, пока курс продаётся", () => {
    expect(courseLessonAction({ invitation: sold, courseHref })).toEqual({
      kind: "purchase",
      href: buyHref,
    });
  });

  it("на страницу курса, когда купить нельзя: оплата была бы тупиком", () => {
    expect(courseLessonAction({ invitation: null, courseHref })).toEqual({
      kind: "course",
      href: courseHref,
    });
  });
});
