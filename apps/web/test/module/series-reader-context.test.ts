import { describe, expect, it } from "vitest";
import { selectCourseNavigation } from "@/features/library-discovery/model/course-navigation-selection";

import {
  readerBodyLinkHref,
  resolveProductReaderContext,
} from "@/_pages/material-reader/model/product-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { parseReaderCourseAnchor } from "@/shared/routing/reader-course-anchor";

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

describe("body links inside a course document", () => {
  const product = {
    kind: "ready" as const,
    reference: { slug: "course", name: "Курс" },
    chapters: [
      {
        id: "one",
        name: "Первая",
        summary: "",
        materialIds: ["lesson-id", "checks-id"],
        supplementaryMaterialIds: ["files-id"],
      },
      { id: "two", name: "Вторая", summary: "", materialIds: ["later-id"] },
    ],
    items: [
      { materialId: "lesson-id", slug: "lesson", title: "Подготовка" },
      { materialId: "checks-id", slug: "checks", title: "Проверки" },
      { materialId: "later-id", slug: "later", title: "Позже" },
      { materialId: "files-id", slug: "files", title: "Файлы агента" },
      { materialId: "brief-id", slug: "brief", title: "Бриф" },
    ],
  };

  /** The Reader context of the page an address opens, read from the address alone. */
  function contextOfOpened(href: string) {
    const url = new URL(href, "https://inside.local");
    const query = url.searchParams;
    return resolveProductReaderContext({
      product,
      currentMaterialSlug: url.pathname.replace("/materials/", ""),
      returnTarget: parseMaterialReaderReturnTarget(
        query.get("from") ?? undefined,
      ),
      anchor: parseReaderCourseAnchor(query.get("anchor") ?? undefined),
      placementId: query.get("placement") ?? undefined,
      referenceView: query.get("view") === "reference",
    });
  }

  function linkFrom(opened: string, href: string): string {
    const target = readerBodyLinkHref(contextOfOpened(opened), href);
    if (target === undefined) throw new Error(`No course link for ${href}`);
    return target;
  }

  const programme = encodeURIComponent("/products/course/programme");
  const supplementary = `/materials/files?from=${programme}&view=reference&anchor=material%3Alesson`;

  it("opens a primary step linked from a supplementary document as that step", () => {
    const href = linkFrom(supplementary, "/materials/checks#раздел");
    expect(href).not.toContain("anchor=");
    expect(href).not.toContain("view=reference");
    expect(href).toMatch(/#раздел$/u);
    const opened = contextOfOpened(href);
    expect(opened?.supplementary).toBeUndefined();
    expect(opened).toMatchObject({
      currentPosition: 2,
      previous: { title: "Подготовка" },
      next: { title: "Позже" },
      programme: {
        current: { id: "material:checks" },
        currentChapterId: "one:0",
      },
    });
  });

  it("opens a primary step of another chapter in that chapter", () => {
    const opened = contextOfOpened(linkFrom(supplementary, "/materials/later"));
    expect(opened?.supplementary).toBeUndefined();
    expect(opened).toMatchObject({
      currentPosition: 3,
      previous: { title: "Проверки" },
      programme: {
        current: { id: "material:later" },
        currentChapterId: "two:1",
      },
    });
  });

  it("opens a primary step linked from a lesson opened for reference as that step", () => {
    const catalogue = `/materials/lesson?from=${encodeURIComponent("/products/course/programme?part=materials&at=lesson")}&view=reference`;
    const href = linkFrom(catalogue, "/materials/checks");
    expect(href).not.toContain("view=reference");
    const opened = contextOfOpened(href);
    expect(opened?.supplementary).toBeUndefined();
    expect(opened).toMatchObject({
      currentPosition: 2,
      programme: { current: { id: "material:checks" } },
    });
  });

  it("returns from a supplementary document to the originating lesson as its step", () => {
    const href = linkFrom(supplementary, "/materials/lesson");
    expect(href).not.toContain("anchor=");
    expect(href).not.toContain("view=reference");
    const opened = contextOfOpened(href);
    expect(opened?.supplementary).toBeUndefined();
    expect(opened).toMatchObject({
      currentPosition: 1,
      next: { title: "Проверки" },
      programme: { current: { id: "material:lesson" } },
    });
  });

  it("keeps the originating step for a document outside the programme steps", () => {
    for (const opened of [
      `/materials/lesson?from=${programme}`,
      supplementary,
    ]) {
      const href = linkFrom(opened, "/materials/brief");
      expect(href).toContain("view=reference");
      expect(href).toContain("anchor=material%3Alesson");
      expect(contextOfOpened(href)).toMatchObject({
        supplementary: true,
        next: null,
        previous: null,
        programme: {
          current: { id: "material:lesson" },
          activeReferenceId: "reference:brief",
        },
      });
    }
  });
});

it("server confirmation preserves the browser's repeated position and originating step", () => {
  const firstId = "00000000-0000-4000-8000-000000000001";
  const secondId = "00000000-0000-4000-8000-000000000002";
  const product = {
    kind: "ready" as const,
    reference: { name: "Course", slug: "platform-inside" },
    chapters: [
      {
        id: "main",
        name: "Chapter",
        summary: "",
        materialIds: ["lesson"],
        supplementaryMaterialIds: ["reference"],
      },
    ],
    programmePlacements: [firstId, secondId].map((id) => ({
      id,
      materialId: "lesson",
      chapterId: "main",
      stepGroup: null,
    })),
    items: [
      { materialId: "lesson", slug: "lesson", title: "Lesson" },
      { materialId: "reference", slug: "reference", title: "Reference" },
    ],
  };
  const first = resolveProductReaderContext({
    currentMaterialSlug: "lesson",
    placementId: firstId,
    product,
    returnTarget: selectedProduct,
  })?.programme;
  if (first == null) throw new Error("The first programme position is missing");
  const second = resolveProductReaderContext({
    currentMaterialSlug: "lesson",
    placementId: secondId,
    product,
    returnTarget: selectedProduct,
  })?.programme;
  if (second == null)
    throw new Error("The second programme position is missing");
  expect(selectCourseNavigation(first, `material:lesson:${secondId}`)).toEqual(
    second,
  );
  expect(second.currentPosition).toBe(2);
  expect(second.previous?.id).toBe(`material:lesson:${firstId}`);
  expect(second.next).toBeNull();
  const reference = resolveProductReaderContext({
    currentMaterialSlug: "reference",
    product,
    returnTarget: selectedProduct,
    anchor: { kind: "material", slug: "lesson", placementId: secondId },
  });
  expect(reference).toMatchObject({
    supplementary: true,
    next: null,
    previous: null,
  });
  expect(selectCourseNavigation(second, "reference:reference")).toEqual(
    reference?.programme,
  );
  expect(
    selectCourseNavigation(
      reference?.programme ?? first,
      `material:lesson:${firstId}`,
    ),
  ).toEqual(first);
});
