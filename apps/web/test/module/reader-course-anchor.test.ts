import { describe, expect, it } from "vitest";
import {
  anchoredMaterialHref,
  ownSectionHref,
  parseReaderCourseAnchor,
} from "@/shared/routing/reader-course-anchor";
import { resolveProductReaderContext } from "@/_pages/material-reader/model/product-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { courseSource } from "@/storybook/course-reading.fixtures";

const returnTarget = parseMaterialReaderReturnTarget(
  "/products/ai-engineering/programme?at=course-intro",
);
const product = {
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
      const context = resolveProductReaderContext({
        currentMaterialSlug: "aie-product-brief",
        returnTarget,
        product,
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
        resolveProductReaderContext({
          currentMaterialSlug: "aie-product-brief",
          returnTarget,
          product,
          anchor: parseReaderCourseAnchor(value),
        }),
      ).toBeNull();
    },
  );
  it("does not lend an anchor to an unrelated document and ignores it on primary navigation", () => {
    const anchor = parseReaderCourseAnchor("task:aie-ch1-onboarding");
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "outside",
        returnTarget,
        product,
        anchor,
      }),
    ).toBeNull();
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "course-intro",
        returnTarget,
        product,
        anchor,
      }),
    ).toMatchObject({
      programme: { current: { id: "material:course-intro" } },
    });
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "course-intro",
        returnTarget,
        product,
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

describe("placement identity validation", () => {
  it("normalizes a valid uppercase placement and rejects an invalid UUID variant", () => {
    expect(
      parseReaderCourseAnchor(
        "material:lesson:95000000-0000-4000-A000-000000000001",
      ),
    ).toEqual({
      kind: "material",
      slug: "lesson",
      placementId: "95000000-0000-4000-a000-000000000001",
    });
    expect(
      parseReaderCourseAnchor(
        "material:lesson:95000000-0000-4000-0000-000000000001",
      ),
    ).toBeUndefined();
  });
});

describe("links to the open Material's own sections", () => {
  it("stay inside the page and leave other addresses alone", () => {
    expect(ownSectionHref("/materials/lesson#практика", "lesson")).toBe(
      "#практика",
    );
    expect(ownSectionHref("/materials/lesson?view=full#a", "lesson")).toBe(
      "#a",
    );
    expect(ownSectionHref("/materials/lesson", "lesson")).toBe(undefined);
    expect(ownSectionHref("/materials/other#a", "lesson")).toBe(undefined);
    expect(ownSectionHref("#a", "lesson")).toBe(undefined);
  });
});
