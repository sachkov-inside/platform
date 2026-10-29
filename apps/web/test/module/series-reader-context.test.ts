import { describe, expect, it } from "vitest";

import { resolveProductReaderContext } from "@/_pages/material-reader/model/product-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

const selectedProduct = parseMaterialReaderReturnTarget(
  "/series/platform-inside?from=%2F",
);

describe("Product Reader context", () => {
  it("keeps project references outside curricular positions", () => {
    const product = {
      kind: "ready" as const,
      reference: { name: "Course", slug: "platform-inside" },
      chapters: [
        { id: "main", name: "Глава", summary: "", materialIds: ["lesson"] },
      ],
      items: [
        { materialId: "brief", slug: "aie-product-brief", title: "Бриф" },
        { materialId: "lesson", slug: "lesson", title: "Урок" },
      ],
    };
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "aie-product-brief",
        returnTarget: selectedProduct,
        product,
      }),
    ).toMatchObject({
      supplementary: true,
      programme: {
        activeReferenceId: "reference:aie-product-brief",
        currentPosition: 0,
        totalMaterials: 1,
      },
    });
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "lesson",
        returnTarget: selectedProduct,
        product,
      }),
    ).toMatchObject({ currentPosition: 1, totalMaterials: 1 });
  });

  it.each([undefined, "/", "/products/other"])(
    "does not guess a product from memberships when from is %s",
    (from) => {
      expect(
        resolveProductReaderContext({
          currentMaterialSlug: "shared",
          returnTarget: parseMaterialReaderReturnTarget(from),
          product: {
            kind: "ready",
            reference: {
              name: "Selected",
              slug: "selected",
              hasModeVariants: true,
            },
            items: [{ slug: "shared", title: "Shared" }],
          },
        }),
      ).toBeNull();
    },
  );
  it.each([
    ["/products/programme", "/products/programme/programme"],
    [
      "/products/programme/programme?from=%2F",
      "/products/programme/programme?from=%2F",
    ],
  ])(
    "keeps programme navigation distinct from a product named programme: %s",
    (origin, expected) => {
      expect(
        resolveProductReaderContext({
          currentMaterialSlug: "first",
          returnTarget: parseMaterialReaderReturnTarget(origin),
          product: {
            kind: "ready",
            reference: { name: "Programme", slug: "programme" },
            items: [{ slug: "first", title: "Первый урок" }],
          },
        })?.product.href,
      ).toBe(expected);
    },
  );
  it("opens the programme even when the lesson was entered from the product description", () => {
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "first",
        returnTarget: parseMaterialReaderReturnTarget(
          "/products/ai-engineering",
        ),
        product: {
          kind: "ready",
          reference: { name: "AI Engineering", slug: "ai-engineering" },
          items: [{ slug: "first", title: "Первый урок" }],
        },
      })?.product.href,
    ).toBe("/products/ai-engineering/programme");
  });
  it("keeps the selected Product order when one Material belongs to several Product", () => {
    const result = resolveProductReaderContext({
      currentMaterialSlug: "shared-material",
      returnTarget: selectedProduct,
      product: {
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
      product: {
        hasModeVariants: false,
        href: "/products/platform-inside/programme",
        name: "Создание Platform Inside",
      },
      totalMaterials: 3,
    });

    const otherProduct = parseMaterialReaderReturnTarget(
      "/series/review-series",
    );
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "shared-material",
        returnTarget: otherProduct,
        product: {
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

  it("preserves linear navigation for an explicit empty chapter list", () => {
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "first",
        returnTarget: selectedProduct,
        product: {
          kind: "ready",
          reference: { name: "Selected", slug: "platform-inside" },
          chapters: [],
          items: [
            { slug: "first", title: "First" },
            { slug: "next", title: "Next" },
          ],
        },
      }),
    ).toMatchObject({
      currentPosition: 1,
      totalMaterials: 2,
      next: { title: "Next" },
    });
  });

  it("uses the complete Product composition beyond a catalog page boundary", () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      slug: `material-${String(index + 1)}`,
      title: `Материал ${String(index + 1)}`,
    }));

    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "material-24",
        returnTarget: selectedProduct,
        product: {
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

  it("does not invent navigation for a Product that does not contain the Material", () => {
    expect(
      resolveProductReaderContext({
        currentMaterialSlug: "independent-material",
        returnTarget: selectedProduct,
        product: {
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

it("retains the originating lesson and marks the reference outside the step sequence", () => {
  const context = resolveProductReaderContext({
    currentMaterialSlug: "aie-product-brief",
    returnTarget: parseMaterialReaderReturnTarget(
      "/products/course/programme?at=lesson",
    ),
    anchor: { kind: "material", slug: "lesson" },
    product: {
      kind: "ready",
      reference: { slug: "course", name: "Курс" },
      chapters: [
        { id: "one", name: "Глава", summary: "", materialIds: ["lesson-id"] },
      ],
      items: [
        { materialId: "brief-id", slug: "aie-product-brief", title: "Бриф" },
        { materialId: "lesson-id", slug: "lesson", title: "Урок" },
      ],
    },
  });
  expect(context).toMatchObject({
    supplementary: true,
    next: null,
    previous: null,
    totalMaterials: 1,
    programme: {
      current: { id: "material:lesson" },
      currentPosition: 1,
      totalSteps: 1,
      activeReferenceId: "reference:aie-product-brief",
    },
  });
});

it("keeps a catalogue-opened programme lesson selected in its chapter outside the step sequence", () => {
  const context = resolveProductReaderContext({
    currentMaterialSlug: "later",
    referenceView: true,
    returnTarget: parseMaterialReaderReturnTarget(
      "/products/course/programme?part=materials&at=later",
    ),
    product: {
      kind: "ready",
      reference: { slug: "course", name: "Курс" },
      chapters: [
        { id: "one", name: "Первая", summary: "", materialIds: ["lesson-id"] },
        { id: "two", name: "Вторая", summary: "", materialIds: ["later-id"] },
      ],
      items: [
        { materialId: "lesson-id", slug: "lesson", title: "Урок" },
        { materialId: "later-id", slug: "later", title: "Позже" },
      ],
    },
  });
  expect(context).toMatchObject({
    supplementary: true,
    currentPosition: 0,
    next: null,
    previous: null,
    programme: {
      current: { id: "material:later" },
      currentChapterId: "two:1",
      currentPosition: 0,
    },
  });
  expect(context?.programme?.activeReferenceId).toBeUndefined();
});

it("follows repeated flat programme positions while excluding catalogue-only documents", () => {
  const product = {
    kind: "ready" as const,
    reference: { name: "Flat", slug: "flat" },
    chapters: [],
    items: [
      { materialId: "a", slug: "a", title: "A" },
      { materialId: "b", slug: "b", title: "B" },
      { materialId: "extra", slug: "extra", title: "Extra" },
    ],
    programmePlacements: [
      { id: "a1", materialId: "a", chapterId: null, stepGroup: null },
      { id: "b1", materialId: "b", chapterId: null, stepGroup: null },
      { id: "a2", materialId: "a", chapterId: null, stepGroup: null },
    ],
  };
  const context = resolveProductReaderContext({
    product,
    currentMaterialSlug: "a",
    placementId: "a2",
    returnTarget: parseMaterialReaderReturnTarget("/products/flat/programme"),
  });
  expect(context).toMatchObject({
    currentPosition: 3,
    totalMaterials: 2,
    next: null,
    previous: { title: "B" },
  });
  expect(context?.previous?.href).toContain("placement=b1");
  expect(
    resolveProductReaderContext({
      product,
      currentMaterialSlug: "extra",
      returnTarget: parseMaterialReaderReturnTarget("/products/flat/programme"),
    }),
  ).toMatchObject({ supplementary: true, next: null, previous: null });
});
