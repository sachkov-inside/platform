import { describe, expect, it } from "vitest";
import { resolveReaderReturnTarget } from "../../src/_pages/material-reader/model/reader-return-target";
import { parseMaterialReaderReturnTarget } from "../../src/shared/routing/material-reader";

const membership = (slug: string) => ({
  ordinal: 1,
  series: { id: slug, name: slug, slug },
});
const material = { seriesMemberships: [membership("ai-engineering")] };

describe("Reader course return without chapter navigation", () => {
  it.each([
    "/products/ai-engineering/programme?at=aie-ch1-harness",
    "/products/ai-engineering/programme?part=materials&at=aie-product-brief",
  ])("preserves supplementary course context: %s", (href) => {
    const returnTarget = parseMaterialReaderReturnTarget(href);
    expect(resolveReaderReturnTarget({ material, returnTarget })).toEqual(
      returnTarget,
    );
  });

  it("returns a direct material to its sole course", () => {
    expect(
      resolveReaderReturnTarget({
        material,
        returnTarget: parseMaterialReaderReturnTarget(undefined),
        inferCourseReturn: true,
      }),
    ).toEqual(
      parseMaterialReaderReturnTarget("/products/ai-engineering/programme"),
    );
  });

  it.each(["/", "/account", "/topics/engineering"])(
    "preserves an explicit source: %s",
    (href) => {
      const returnTarget = parseMaterialReaderReturnTarget(href);
      expect(resolveReaderReturnTarget({ material, returnTarget })).toEqual(
        returnTarget,
      );
    },
  );

  it.each([
    { seriesMemberships: [] },
    { seriesMemberships: [membership("first"), membership("second")] },
  ])(
    "does not guess an ambiguous or absent course",
    ({ seriesMemberships }) => {
      expect(
        resolveReaderReturnTarget({
          material: { seriesMemberships },
          returnTarget: parseMaterialReaderReturnTarget(undefined),
          inferCourseReturn: true,
        }).kind,
      ).toBe("home");
    },
  );

  it("rejects an unrelated product return", () => {
    expect(
      resolveReaderReturnTarget({
        material,
        returnTarget: parseMaterialReaderReturnTarget(
          "/products/unrelated/programme",
        ),
      }).kind,
    ).toBe("home");
  });

  it("keeps a course confirmed by its published composition", () => {
    const returnTarget = parseMaterialReaderReturnTarget(
      "/products/course/programme",
    );
    expect(
      resolveReaderReturnTarget({ returnTarget, hasSeriesContext: true }),
    ).toEqual(returnTarget);
  });
});
