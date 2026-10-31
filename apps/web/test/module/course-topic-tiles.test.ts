import { describe, expect, test } from "vitest";

import { courseTopicTile } from "@/_pages/library-discovery/model/course-topic-tiles";
import { aiEngineeringCoursePage } from "@/storybook/ai-engineering-course.fixtures";

/** Темы описания курса на production до переноса нового лендинга (sachkov.dev, 30.10.2026). */
const publishedTopics = [
  "AI-first разработка",
  "Harness",
  "Работа с контекстом",
  "Пайплайны разработки",
  "Собственные агенты",
  "RAG",
  "Контроль агентов",
  "Evals и эксплуатация",
  "MCP и инструменты агентов",
  "Экономия токенов",
];

function topicsOf(page: typeof aiEngineeringCoursePage): string[] {
  const block = page.blocks.find((item) => item.id === "topics");
  if (block?.kind !== "cards") throw new Error("Missing topics block");
  return block.items.map((item) => item.title);
}

/** Сколько колонок сетки занимают плитки подряд: широкая две, узкая одну. */
function spans(titles: readonly string[]): number[] {
  return titles.map((title) =>
    courseTopicTile(title)?.size === "wide" ? 2 : 1,
  );
}

describe("Course topic tiles", () => {
  test("gives every topic of the accepted landing description its own illustration", () => {
    for (const title of topicsOf(aiEngineeringCoursePage)) {
      expect(courseTopicTile(title), title).toBeDefined();
    }
  });

  test("keeps illustrations for the description published before the new landing", () => {
    for (const title of publishedTopics) {
      expect(courseTopicTile(title), title).toBeDefined();
    }
  });

  test("binds an illustration to the topic, not to its position", () => {
    const tiles = publishedTopics.map((title) => courseTopicTile(title));
    const reversed = publishedTopics
      .toReversed()
      .map((title) => courseTopicTile(title));
    expect(reversed).toEqual(tiles.toReversed());
    expect(courseTopicTile("RAG")?.art).toBe("rag");
    expect(courseTopicTile("AI-first разработка")?.art).not.toBe(
      courseTopicTile("Harness")?.art,
    );
  });

  test("leaves an unknown topic without an illustration", () => {
    expect(courseTopicTile("Тема, которой нет")).toBeUndefined();
  });

  test("fills whole rows of the four-column grid", () => {
    for (const titles of [topicsOf(aiEngineeringCoursePage), publishedTopics]) {
      let row = 0;
      for (const span of spans(titles)) {
        row += span;
        expect(row).toBeLessThanOrEqual(4);
        if (row === 4) row = 0;
      }
      expect(row).toBe(0);
    }
  });
});
