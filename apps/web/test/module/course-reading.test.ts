import { describe, expect, it } from "vitest";
import { courseReadingContext } from "@/features/library-discovery";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

const task = (code: string, afterMaterialId: string | null = null) => ({
  code,
  title: code,
  afterMaterialId,
  access: "free" as const,
  availability: "available" as const,
  lastSubmittedAt: null,
});
const series = {
  kind: "ready" as const,
  reference: { slug: "course", name: "Курс", hasModeVariants: true },
  items: [
    {
      materialId: "first-id",
      slug: "first",
      title: "Первый",
      availability: "available" as const,
    },
    {
      materialId: "second-id",
      slug: "second",
      title: "Второй",
      availability: "locked" as const,
    },
  ],
  chapters: [
    {
      id: "one",
      name: "Первая",
      materialIds: ["first-id"],
      tasks: [
        task("opening"),
        task("missing", "absent"),
        task("a", "first-id"),
        task("b", "first-id"),
      ],
    },
    { id: "two", name: "Вторая", materialIds: ["second-id"], tasks: [] },
    { id: "three", name: "Без уроков", materialIds: [], tasks: [task("only")] },
  ],
} as const;

describe("course reading composition", () => {
  it("lists only actual chapters and counts only their materials", () => {
    const context = courseReadingContext({
      series: {
        ...series,
        items: [
          { materialId: "project", slug: "aie-project", title: "Проект" },
          ...series.items,
          { materialId: "brief", slug: "aie-product-brief", title: "Бриф" },
        ],
      },
      current: { kind: "material", slug: "second" },
    });
    expect(context?.chapters.map(({ name }) => name)).toEqual([
      "Первая",
      "Вторая",
      "Без уроков",
    ]);
    expect(context?.totalMaterials).toBe(2);
    expect(context?.current.materialOrdinal).toBe(2);
    expect(context?.next?.id).toBe("task:only");
  });

  it.each(["aie-ch1-project-setup"])(
    "keeps arbitrary supplementary %s in its course context",
    (slug) => {
      expect(
        courseReadingContext({
          series: {
            ...series,
            items: [...series.items, { materialId: slug, slug, title: slug }],
          },
          current: { kind: "material", slug },
          returnTarget: parseMaterialReaderReturnTarget(
            "/products/course/programme?at=first",
          ),
        })?.activeReferenceId,
      ).toBe(`reference:${slug}`);
    },
  );

  it("places leading, missing-anchor and adjacent tasks across chapters without renumbering materials", () => {
    const context = courseReadingContext({
      series,
      current: { kind: "task", code: "b" },
    });
    expect(
      context?.chapters.flatMap((chapter) =>
        chapter.steps.map((step) => step.id),
      ),
    ).toEqual([
      "task:opening",
      "task:missing",
      "material:first",
      "task:a",
      "task:b",
      "material:second",
      "task:only",
    ]);
    expect(context?.previous?.id).toBe("task:a");
    expect(context?.next).toMatchObject({
      id: "material:second",
      materialOrdinal: 2,
      availability: "locked",
    });
    expect(context?.totalMaterials).toBe(2);
    expect(context?.currentPosition).toBe(5);
    expect(context?.hasModeVariants).toBe(true);
  });

  it("numbers tasks in authored chapter order, independently of lesson placement and titles", () => {
    const context = courseReadingContext({
      series: {
        ...series,
        chapters: [
          {
            ...series.chapters[0],
            tasks: [task("authored-first", "first-id"), task("leading-second")],
          },
          { ...series.chapters[1], tasks: [task("chapter-two-first")] },
        ],
      },
      current: { kind: "task", code: "authored-first" },
    });
    expect(
      context?.chapters.map((chapter) =>
        chapter.steps
          .filter((step) => step.kind === "task")
          .map((step) => ({
            id: step.id,
            title: step.title,
            ordinal: step.taskOrdinal,
          })),
      ),
    ).toEqual([
      [
        { id: "task:leading-second", title: "leading-second", ordinal: 2 },
        { id: "task:authored-first", title: "authored-first", ordinal: 1 },
      ],
      [
        {
          id: "task:chapter-two-first",
          title: "chapter-two-first",
          ordinal: 1,
        },
      ],
    ]);
    expect(context?.current.id).toBe("task:authored-first");
    expect(context?.current.materialOrdinal).toBeUndefined();
    expect(context?.next?.id).toBe("task:chapter-two-first");
  });

  it("marks only saved task submissions, independently of the currently open step", () => {
    const source = {
      ...series,
      chapters: [
        {
          ...series.chapters[0],
          tasks: [
            {
              ...task("saved", "first-id"),
              lastSubmittedAt: "2026-10-14T09:00:00.000Z",
            },
            task("not-submitted", "first-id"),
          ],
        },
      ],
    };
    for (const code of ["saved", "not-submitted"]) {
      const context = courseReadingContext({
        series: source,
        current: { kind: "task", code },
      });
      expect(
        context?.chapters[0]?.steps
          .filter((step) => step.kind === "task")
          .map((step) => [step.id, step.taskSubmitted]),
      ).toEqual([
        ["task:saved", true],
        ["task:not-submitted", false],
      ]);
      expect(context?.current.title).toBe(code);
    }
  });

  it("retains a task-only empty product and does not invent a missing step", () => {
    const empty = {
      ...series,
      kind: "empty" as const,
      items: undefined,
      chapters: [series.chapters[2]],
    };
    expect(
      courseReadingContext({
        series: empty,
        current: { kind: "task", code: "only" },
      }),
    ).toMatchObject({
      totalMaterials: 0,
      currentPosition: 1,
      previous: null,
      next: null,
    });
    expect(
      courseReadingContext({
        series,
        current: { kind: "material", slug: "absent" },
      }),
    ).toBeNull();
  });

  it("keeps explicit material return context and task addresses", () => {
    const context = courseReadingContext({
      series,
      current: { kind: "material", slug: "first" },
      returnTarget: parseMaterialReaderReturnTarget(
        "/products/course/programme?at=first",
      ),
    });
    expect(context?.current.href).toBe(
      "/materials/first?from=%2Fproducts%2Fcourse%2Fprogramme%3Fat%3Dfirst",
    );
    expect(context?.next?.href).toBe("/products/course/tasks/a");
  });
});

it("embedded practice remains one Material step with its saved submission, and legacy has no extra row", () => {
  const embedded = {
    ...task("practice"),
    programmeVisibility: "embedded" as const,
    embeddedMaterialId: "first-id",
    lastSubmittedAt: "2026-10-15T12:00:00.000Z",
  };
  const context = courseReadingContext({
    series: {
      ...series,
      chapters: [
        { ...series.chapters[0], tasks: [embedded] },
        series.chapters[1],
      ],
    },
    current: { kind: "material", slug: "first" },
  });
  expect(context?.totalSteps).toBe(2);
  expect(context?.current).toMatchObject({
    kind: "material",
    practiceTaskCode: "practice",
    taskSubmitted: true,
  });
  expect(context?.next?.id).toBe("material:second");
  expect(
    context?.chapters
      .flatMap((chapter) => chapter.steps)
      .some((step) => step.kind === "task"),
  ).toBe(false);
});

describe("supplementary Material navigation", () => {
  const referenceSeries = {
    ...series,
    items: [
      ...series.items,
      { materialId: "brief", slug: "aie-product-brief", title: "Бриф" },
      { materialId: "project", slug: "aie-project", title: "Описание проекта" },
      { materialId: "extra", slug: "extra", title: "Другой материал" },
    ],
  };

  it("lists every non-programme Product member in Product order without changing chapter steps", () => {
    const current = { kind: "material" as const, slug: "first" };
    const before = courseReadingContext({ series, current });
    const context = courseReadingContext({ series: referenceSeries, current });
    expect(context?.references?.map(({ slug }) => slug)).toEqual([
      "first",
      "second",
      "aie-product-brief",
      "aie-project",
      "extra",
    ]);
    expect(context?.chapters).toEqual(before?.chapters);
    expect(context?.totalSteps).toBe(before?.totalSteps);
    expect(context?.totalMaterials).toBe(before?.totalMaterials);
    expect(context?.next).toEqual(before?.next);
  });

  it("opens a reference from the programme without claiming a curricular position", () => {
    const context = courseReadingContext({
      series: referenceSeries,
      current: { kind: "material", slug: "aie-project" },
      returnTarget: parseMaterialReaderReturnTarget(
        "/products/course/programme",
      ),
    });
    expect(context).toMatchObject({
      activeReferenceId: "reference:aie-project",
      currentPosition: 0,
      totalMaterials: 2,
      previous: null,
      next: null,
    });
    expect(
      context?.chapters
        .flatMap(({ steps }) => steps)
        .some(({ id }) => id === "reference:aie-project"),
    ).toBe(false);
  });

  it("does not invent a reference missing from published Product membership", () => {
    const context = courseReadingContext({
      series,
      current: { kind: "material", slug: "first" },
    });
    expect(
      context?.references?.some((entry) => entry.slug === "aie-project"),
    ).toBe(false);
  });
});

it.each([8, 9])(
  "derives %i chapter steps from current Product composition independently of project references",
  (count) => {
    const items = Array.from({ length: count }, (_, index) => ({
      materialId: `lesson-${String(index + 1)}`,
      slug: `lesson-${String(index + 1)}`,
      title: `Урок ${String(index + 1)}`,
    }));
    const context = courseReadingContext({
      series: {
        kind: "ready",
        reference: { slug: "course", name: "Курс" },
        chapters: [
          {
            id: "first",
            name: "Глава",
            materialIds: items.map(({ materialId }) => materialId),
          },
        ],
        items: [
          ...items,
          {
            materialId: "project",
            slug: "aie-project",
            title: "Описание проекта",
          },
          { materialId: "brief", slug: "aie-product-brief", title: "Бриф" },
        ],
      },
      current: { kind: "material", slug: "lesson-1" },
    });
    expect(context?.totalSteps).toBe(count);
    expect(context?.totalMaterials).toBe(count);
    expect(context?.chapters[0]?.steps.map(({ id }) => id)).toEqual(
      items.map(({ slug }) => `material:${slug}`),
    );
    expect(context?.references).toHaveLength(count + 2);
  },
);

it("uses authored chapter attachments without slug conventions or extra steps", () => {
  const context = courseReadingContext({
    series: {
      ...series,
      chapters: series.chapters.map((chapter, index) => ({
        ...chapter,
        supplementaryMaterialIds: index === 1 ? ["reference-id"] : [],
      })),
      items: [
        ...series.items,
        {
          materialId: "reference-id",
          slug: "arbitrary-customer-document",
          title: "Документ",
        },
      ],
    },
    current: { kind: "material", slug: "arbitrary-customer-document" },
  });
  expect(context?.currentChapterId).toBe("two:1");
  expect(context?.chapters[1]?.references?.map((entry) => entry.slug)).toEqual([
    "arbitrary-customer-document",
  ]);
  expect(context?.totalMaterials).toBe(2);
  expect(context?.currentPosition).toBe(0);
  expect(context?.next).toBeNull();
});

it("keeps repeated Material positions distinct with a single shared Material identity", () => {
  const repeated = {
    ...series,
    chapters: [
      {
        ...series.chapters[0],
        materialIds: ["first-id", "second-id", "first-id"],
      },
    ],
    programmePlacements: [
      { id: "a1", materialId: "first-id", chapterId: "one", stepGroup: null },
      { id: "b1", materialId: "second-id", chapterId: "one", stepGroup: null },
      { id: "a2", materialId: "first-id", chapterId: "one", stepGroup: null },
    ],
  };
  const context = courseReadingContext({
    series: repeated,
    current: { kind: "material", slug: "first", placementId: "a2" },
  });
  expect(context?.current.id).toBe("material:first:a2");
  expect(context?.totalMaterials).toBe(2);
  expect(context?.current.href).toContain("placement=a2");
  expect(
    context?.chapters[0]?.steps.filter((step) => step.id === "task:a"),
  ).toHaveLength(1);
});
