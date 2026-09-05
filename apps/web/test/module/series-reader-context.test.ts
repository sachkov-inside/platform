import { describe, expect, it } from "vitest";

import { resolveSeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

const selectedSeries = parseMaterialReaderReturnTarget(
  "/series/platform-inside?from=%2F",
);

describe("Series Reader context", () => {
  it("keeps the selected Series order when one Material belongs to several Series", () => {
    const result = resolveSeriesReaderContext({
      currentMaterialSlug: "shared-material",
      returnTarget: selectedSeries,
      series: {
        kind: "ready",
        reference: {
          name: "Создание Platform Inside",
          slug: "platform-inside",
        },
        items: [
          { slug: "first", title: "Сначала границы" },
          { slug: "shared-material", title: "Общий материал" },
          { slug: "last", title: "Затем проверка" },
        ],
      },
    });

    expect(result).toEqual({
      currentPosition: 2,
      next: {
        href: "/materials/last?from=%2Fseries%2Fplatform-inside%3Ffrom%3D%252F",
        title: "Затем проверка",
      },
      previous: {
        href: "/materials/first?from=%2Fseries%2Fplatform-inside%3Ffrom%3D%252F",
        title: "Сначала границы",
      },
      series: {
        href: "/series/platform-inside?from=%2F",
        name: "Создание Platform Inside",
      },
      totalMaterials: 3,
    });

    const otherSeries = parseMaterialReaderReturnTarget("/series/review-series");
    expect(
      resolveSeriesReaderContext({
        currentMaterialSlug: "shared-material",
        returnTarget: otherSeries,
        series: {
          kind: "ready",
          reference: {
            name: "Review",
            slug: "review-series",
          },
          items: [
            { slug: "shared-material", title: "Общий материал" },
            { slug: "review-video", title: "Видео-разбор" },
            { slug: "review-note", title: "Итоговая заметка" },
          ],
        },
      })?.next,
    ).toEqual({
      href: "/materials/review-video?from=%2Fseries%2Freview-series",
      title: "Видео-разбор",
    });
  });

  it("uses the complete Series composition beyond a catalog page boundary", () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      slug: `material-${String(index + 1)}`,
      title: `Материал ${String(index + 1)}`,
    }));

    expect(
      resolveSeriesReaderContext({
        currentMaterialSlug: "material-24",
        returnTarget: selectedSeries,
        series: {
          kind: "ready",
          items,
          reference: {
            name: "Создание Platform Inside",
            slug: "platform-inside",
          },
        },
      }),
    ).toMatchObject({
      currentPosition: 24,
      next: { title: "Материал 25" },
      previous: { title: "Материал 23" },
      totalMaterials: 30,
    });
  });

  it("does not invent navigation for a Series that does not contain the Material", () => {
    expect(
      resolveSeriesReaderContext({
        currentMaterialSlug: "independent-material",
        returnTarget: selectedSeries,
        series: {
          kind: "ready",
          reference: {
            name: "Создание Platform Inside",
            slug: "platform-inside",
          },
          items: [{ slug: "another", title: "Другой материал" }],
        },
      }),
    ).toBeNull();
  });
});
