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
