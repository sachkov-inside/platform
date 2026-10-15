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

  it.each(["aie-project", "aie-product-brief", "aie-ch1-project-setup"])(
    "keeps supplementary %s standalone despite a programme return target",
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
        }),
      ).toBeNull();
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
