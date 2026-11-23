import { describe, expect, it } from "vitest";

import {
  chapterRoadmapStatus,
  courseRoadmap,
  parseChapterSummary,
} from "@/_pages/library-discovery/ui/course-roadmap";
import type { MaterialPreview } from "@/entities/material";
import type { ProductChapter } from "@/features/library-discovery";

function lesson(id: string): MaterialPreview {
  return {
    materialId: id,
    slug: id,
    title: id,
    access: "free",
    availability: "available",
    format: "Гайд",
    formatSlug: "guide",
    summary: "",
    topic: "AI Engineering",
    topicSlug: "ai-engineering",
    tags: [],
    productMemberships: [],
  };
}

function chapter(
  id: string,
  materialIds: readonly string[],
  extra: Partial<ProductChapter> = {},
): ProductChapter {
  return { id, name: id, summary: "", materialIds, ...extra };
}

describe("Course roadmap status", () => {
  it("takes the stored status of a chapter", () => {
    expect(chapterRoadmapStatus({ roadmapStatus: "writing" }, true)).toBe(
      "writing",
    );
    expect(chapterRoadmapStatus({ roadmapStatus: "done" }, false)).toBe("done");
  });

  it("derives done for a chapter with lessons and planned for an empty one", () => {
    expect(chapterRoadmapStatus({}, true)).toBe("done");
    expect(chapterRoadmapStatus({}, false)).toBe("planned");
  });
});

describe("Course roadmap of a Product", () => {
  const items = ["a", "b", "c", "d"].map(lesson);

  it("counts published and upcoming lessons for each chapter", () => {
    const roadmap = courseRoadmap({
      items,
      chapters: [
        chapter("first", ["a", "b"]),
        chapter("second", ["c", "d"], {
          roadmapStatus: "writing",
          upcomingLessons: [
            { title: "Следующий", state: "writing" },
            { title: "Потом", state: "soon" },
          ],
        }),
        chapter("third", []),
      ],
    });
    expect(roadmap).toEqual([
      {
        id: "first",
        status: "done",
        ready: 2,
        materialIds: ["a", "b"],
        upcoming: 0,
      },
      {
        id: "second",
        status: "writing",
        ready: 2,
        materialIds: ["c", "d"],
        upcoming: 2,
      },
      {
        id: "third",
        status: "planned",
        ready: 0,
        materialIds: [],
        upcoming: 0,
      },
    ]);
  });

  it("counts only published lessons of a chapter, by placement when the programme has them", () => {
    const roadmap = courseRoadmap({
      items: items.slice(0, 1),
      chapters: [chapter("first", ["a", "b"]), chapter("second", ["c"])],
      programmePlacements: [{ materialId: "a", chapterId: "second" }],
    });
    expect(
      roadmap.map(({ status, ready, materialIds }) => [
        status,
        ready,
        materialIds,
      ]),
    ).toEqual([
      ["planned", 0, []],
      ["done", 1, ["a"]],
    ]);
  });

  it("treats a chapter with tasks only as one that has content", () => {
    const roadmap = courseRoadmap({
      items: [],
      chapters: [
        chapter("tasks", [], {
          tasks: [
            {
              code: "t",
              title: "Задание",
              access: "free",
              afterMaterialId: null,
              availability: "available",
              lastSubmittedAt: null,
            },
          ],
        }),
      ],
    });
    expect(roadmap[0]?.status).toBe("done");
  });
});

describe("Chapter summary parts", () => {
  it("takes the first paragraph as the outcome and `- ` lines as topics", () => {
    expect(
      parseChapterSummary(
        "Пишем своего агента.\n\n- Инструменты\n- **RAG.** Поиск контекста\n\nЕщё абзац.",
      ),
    ).toEqual({
      outcome: "Пишем своего агента.",
      sections: [
        { kind: "topics", topics: ["Инструменты", "**RAG.** Поиск контекста"] },
        { kind: "text", text: "Ещё абзац." },
      ],
    });
  });

  it("has no outcome for an empty summary", () => {
    expect(parseChapterSummary("  ")).toEqual({ outcome: "", sections: [] });
  });
});

describe("roadmap counts", () => {
  it("declines lessons after the total count", async () => {
    const { formatOfLessons } =
      await import("@/_pages/library-discovery/ui/product-counts");
    expect(formatOfLessons(1)).toBe("из 1 урока");
    expect(formatOfLessons(7)).toBe("из 7 уроков");
    expect(formatOfLessons(21)).toBe("из 21 урока");
  });
});
