import { describe, expect, it } from "vitest";
import {
  courseChapterProgress,
  courseReadingContext,
  courseStepProgress,
  type CourseReadingStep,
} from "@/features/library-discovery";
import { internalRoute } from "@/shared/routing/internal-route";

const href = internalRoute("/materials/lesson");

const material = (
  materialId: string,
  extra: Partial<CourseReadingStep> = {},
): CourseReadingStep => ({
  id: `material:${materialId}`,
  title: materialId,
  href,
  kind: "material",
  availability: "available",
  materialId,
  ...extra,
});
const task = (code: string, taskSubmitted: boolean): CourseReadingStep => ({
  id: `task:${code}`,
  title: code,
  href,
  kind: "task",
  availability: "available",
  taskSubmitted,
});
const marks = (entries: Record<string, boolean>) =>
  new Map(
    Object.entries(entries).map(([id, isRead]) => [id, { isRead, version: 1 }]),
  );

describe("course step progress", () => {
  it("follows the saved mark and submission, not the position in the chapter", () => {
    const states = marks({ read: true, unread: false });
    expect(courseStepProgress(material("read"), states)).toBe("done");
    expect(courseStepProgress(material("unread"), states)).toBe("todo");
    expect(courseStepProgress(task("sent", true), states)).toBe("done");
    expect(courseStepProgress(task("open", false), states)).toBe("todo");
  });

  it("counts a submitted embedded practice as passed even before its mark", () => {
    expect(
      courseStepProgress(
        material("practice", { practiceTaskCode: "p", taskSubmitted: true }),
        marks({ practice: false }),
      ),
    ).toBe("done");
  });

  it("claims nothing for a guest or for a mark that has not arrived", () => {
    expect(courseStepProgress(material("read"), null)).toBe("unknown");
    expect(courseStepProgress(task("open", false), null)).toBe("unknown");
    expect(courseStepProgress(task("sent", true), null)).toBe("done");
    expect(courseStepProgress(material("pending"), marks({}))).toBe("unknown");
    const { taskSubmitted: _status, ...pendingTask } = task("pending", false);
    expect(courseStepProgress(pendingTask, marks({}))).toBe("unknown");
  });

  it("summarises a chapter by its rows once every row is known", () => {
    const steps = [
      material("a"),
      material("b"),
      task("t", true),
      material("a", { id: "material:a:repeat" }),
    ];
    expect(courseChapterProgress(steps, marks({ a: true, b: false }))).toEqual({
      done: 3,
      total: 4,
    });
    expect(courseChapterProgress(steps, marks({ a: true }))).toBeNull();
    expect(courseChapterProgress(steps, null)).toBeNull();
    expect(courseChapterProgress([], marks({}))).toBeNull();
  });
});

it("course steps carry the Material identity used by saved reading marks", () => {
  const context = courseReadingContext({
    product: {
      kind: "ready",
      reference: { slug: "course", name: "Курс" },
      items: [{ materialId: "first-id", slug: "first", title: "Первый" }],
      chapters: [
        {
          id: "one",
          name: "Первая",
          materialIds: ["first-id"],
          tasks: [],
        },
      ],
    },
    current: { kind: "material", slug: "first" },
  });
  expect(context?.current.materialId).toBe("first-id");
});
