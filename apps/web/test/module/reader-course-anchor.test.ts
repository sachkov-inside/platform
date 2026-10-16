import { describe, expect, it } from "vitest";
import {
  anchoredMaterialHref,
  parseReaderCourseAnchor,
} from "@/shared/routing/reader-course-anchor";
import { resolveSeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { courseSource } from "@/storybook/course-reading.fixtures";

const returnTarget = parseMaterialReaderReturnTarget(
  "/products/ai-engineering/programme?at=course-intro",
);
const series = {
  ...courseSource,
  chapters: courseSource.chapters.map((chapter) => ({
    ...chapter,
    summary: "",
  })),
};

describe("Supplementary reading anchored to a primary course step", () => {
  it("keeps authored fragments and independent course/anchor values", () => {
    const href = anchoredMaterialHref(
      "/materials/aie-product-brief?view=full#requirements",
      returnTarget.href,
      { kind: "task", code: "aie-ch1-onboarding" },
    );
    const url = new URL(href ?? "", "https://inside.test");
    expect(url.searchParams.get("from")).toBe(returnTarget.href);
    expect(url.searchParams.get("anchor")).toBe("task:aie-ch1-onboarding");
    expect(url.searchParams.get("view")).toBe("full");
    expect(url.hash).toBe("#requirements");
    expect(
      anchoredMaterialHref(
        "https://other.test/materials/brief",
        returnTarget.href,
        { kind: "task", code: "one" },
      ),
    ).toBeUndefined();
    for (const invalid of [
      undefined,
      ["task:one"],
      "task:../one",
      "chapter:one",
      "task:ONE",
    ])
      expect(parseReaderCourseAnchor(invalid)).toBeUndefined();
  });
  it.each(["material:course-intro", "task:aie-ch1-onboarding"])(
    "uses %s only as a sidebar anchor",
    (value) => {
      const context = resolveSeriesReaderContext({
        currentMaterialSlug: "aie-product-brief",
        returnTarget,
        series,
        anchor: parseReaderCourseAnchor(value),
      });
      expect(context).toMatchObject({
        supplementary: true,
        next: null,
        previous: null,
        totalMaterials: 3,
        programme: { current: { id: value }, totalSteps: 4 },
      });
      expect(
        context?.programme?.chapters
          .flatMap((chapter) => chapter.steps)
          .some((step) => step.id === "material:aie-product-brief"),
      ).toBe(false);
    },
  );
  it.each(["task:absent", "material:next", "material:aie-product-brief"])(
    "uses standalone fallback for inaccessible or missing anchor %s",
    (value) => {
      expect(
        resolveSeriesReaderContext({
          currentMaterialSlug: "aie-product-brief",
          returnTarget,
          series,
          anchor: parseReaderCourseAnchor(value),
        }),
      ).toBeNull();
    },
  );
  it("does not lend an anchor to an unrelated document and ignores it on primary navigation", () => {
    const anchor = parseReaderCourseAnchor("task:aie-ch1-onboarding");
    expect(
      resolveSeriesReaderContext({
        currentMaterialSlug: "outside",
        returnTarget,
        series,
        anchor,
      }),
    ).toBeNull();
    expect(
      resolveSeriesReaderContext({
        currentMaterialSlug: "course-intro",
        returnTarget,
        series,
        anchor,
      }),
    ).toMatchObject({
      programme: { current: { id: "material:course-intro" } },
    });
    expect(
      resolveSeriesReaderContext({
        currentMaterialSlug: "course-intro",
        returnTarget,
        series,
        anchor,
      })?.supplementary,
    ).toBeUndefined();
  });
});

it("keeps course context without inventing an origin for programme reference links", () => {
  expect(
    anchoredMaterialHref(
      "/materials/aie-product-brief#download",
      parseMaterialReaderReturnTarget("/products/course/programme").href,
    ),
  ).toBe(
    "/materials/aie-product-brief?from=%2Fproducts%2Fcourse%2Fprogramme#download",
  );
});
