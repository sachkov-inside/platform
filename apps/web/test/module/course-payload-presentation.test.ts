import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductLandingView } from "@/_pages/library-discovery/ui/product-landing-view";
import { getPublishedSeries } from "@/features/library-discovery.server";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

import { performanceProductPage } from "../navigation/course-payload.fixtures.mjs";

describe("Course payload navigation fixture", () => {
  it("reaches the AI Engineering adapter and actual film through the production discovery mapper", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          chapters: [],
          hasNext: false,
          items: [],
          kind: "series",
          reference: {
            cover: null,
            id: "11111111-1111-4111-8111-111111111115",
            name: "Курс на 120 материалов",
            productPage: performanceProductPage,
            slug: "performance-course",
            summary: "Синтетический продукт для проверки мгновенных переходов.",
          },
          relatedSeries: [],
          topics: [],
        }),
      ),
    );

    const result = await getPublishedSeries("performance-course");
    if (result.kind !== "empty")
      throw new Error("Expected the Product fixture");
    const html = renderToString(
      createElement(ProductLandingView, {
        result,
        returnTarget: homeMaterialReaderReturnTarget,
      }),
    );
    expect(html).toContain('data-product-presentation="ai-engineering-course"');
    expect(html).toContain("<canvas");
    expect(html).toContain("Анимация курса: навыки AI-инженера. Агент");
  });
});
