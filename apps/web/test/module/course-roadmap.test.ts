import { describe, expect, it } from "vitest";

import {
  chapterRoadmapStatus,
  courseRoadmap,
  formatRoadmapUpdatedOn,
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

  it("counts done chapters and shares each segment by its ready lessons", () => {
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
    expect(roadmap.doneCount).toBe(1);
    expect(roadmap.chapters).toEqual([
      { id: "first", status: "done", ready: 2, upcoming: 0, share: 1 },
      { id: "second", status: "writing", ready: 2, upcoming: 2, share: 0.5 },
      { id: "third", status: "planned", ready: 0, upcoming: 0, share: 0 },
    ]);
  });

  it("counts only published lessons of a chapter, by placement when the programme has them", () => {
    const roadmap = courseRoadmap({
      items: items.slice(0, 1),
      chapters: [chapter("first", ["a", "b"]), chapter("second", ["c"])],
      programmePlacements: [{ materialId: "a", chapterId: "second" }],
    });
    expect(
      roadmap.chapters.map(({ status, ready }) => [status, ready]),
    ).toEqual([
      ["planned", 0],
      ["done", 1],
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
    expect(roadmap.chapters[0]?.status).toBe("done");
  });

  it("gives a writing chapter without lessons an empty segment", () => {
    const roadmap = courseRoadmap({
      items: [],
      chapters: [chapter("w", [], { roadmapStatus: "writing" })],
    });
    expect(roadmap.chapters[0]?.share).toBe(0);
  });
});

describe("Roadmap update date", () => {
  it("names the day and the month in the genitive without the current year", () => {
    expect(formatRoadmapUpdatedOn("2026-11-13", 2026)).toBe("13 ноября");
    expect(formatRoadmapUpdatedOn("2026-01-01", 2026)).toBe("1 января");
    expect(formatRoadmapUpdatedOn("2026-05-31", 2026)).toBe("31 мая");
  });

  it("adds the year of another year or before the current year is known", () => {
    expect(formatRoadmapUpdatedOn("2025-12-30", 2026)).toBe("30 декабря 2025");
    expect(formatRoadmapUpdatedOn("2026-03-08", null)).toBe("8 марта 2026");
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
  it("agrees the verb with the number of done chapters", async () => {
    const { formatDoneChapters, formatOfLessons } =
      await import("@/_pages/library-discovery/ui/product-counts");
    expect(formatDoneChapters(1)).toBe("Готова 1 глава");
    expect(formatDoneChapters(2)).toBe("Готовы 2 главы");
    expect(formatDoneChapters(7)).toBe("Готово 7 глав");
    expect(formatDoneChapters(11)).toBe("Готово 11 глав");
    expect(formatOfLessons(1)).toBe("из 1 урока");
    expect(formatOfLessons(7)).toBe("из 7 уроков");
    expect(formatOfLessons(21)).toBe("из 21 урока");
  });
});
