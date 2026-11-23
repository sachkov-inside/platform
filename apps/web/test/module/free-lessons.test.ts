import { describe, expect, it } from "vitest";

import type { MaterialPreview } from "@/entities/material";
import {
  countFreeLessons,
  hasFreeFirstLesson,
} from "@/_pages/library-discovery/model/free-lessons";

function lesson(
  slug: string,
  access: "free" | "closed",
  availability: "available" | "locked" | "unavailable",
): MaterialPreview {
  return {
    materialId: `material-${slug}`,
    slug,
    title: `Урок ${slug}`,
    summary: "",
    format: "Гайд",
    topic: "Разработка",
    topicSlug: "development",
    tags: [],
    access,
    availability,
    productMemberships: [],
  };
}

describe("бесплатные уроки курса", () => {
  it("считают бесплатный урок, который гостю откроется после входа (#1825)", () => {
    expect(
      countFreeLessons([
        lesson("intro", "free", "available"),
        lesson("choose-agent", "free", "locked"),
      ]),
    ).toBe(2);
  });

  it("не считают закрытые уроки и бесплатные, доступ к которым не удалось проверить", () => {
    expect(
      countFreeLessons([
        lesson("first-version", "closed", "locked"),
        lesson("unchecked", "free", "unavailable"),
      ]),
    ).toBe(0);
  });
});

describe("первый бесплатный урок программы", () => {
  const placement = (materialSlug: string, id: string) => ({
    id,
    materialId: `material-${materialSlug}`,
    chapterId: null,
    stepGroup: null,
  });

  it("распознаёт бесплатный первый урок по порядку программы", () => {
    expect(
      hasFreeFirstLesson(
        [
          lesson("choose-agent", "free", "locked"),
          lesson("intro", "free", "locked"),
        ],
        [placement("intro", "p-1"), placement("choose-agent", "p-2")],
      ),
    ).toBe(true);
  });

  it("не предлагает бесплатный старт с первого урока, если первый урок программы закрыт или его доступ не проверен", () => {
    for (const first of [
      lesson("intro", "closed", "locked"),
      lesson("intro", "free", "unavailable"),
    ])
      expect(
        hasFreeFirstLesson(
          [first, lesson("next", "free", "locked")],
          [placement("intro", "p-1"), placement("next", "p-2")],
        ),
      ).toBe(false);
  });

  it("не выбирает урок, когда порядок программы неизвестен", () => {
    expect(
      hasFreeFirstLesson([lesson("intro", "free", "locked")], undefined),
    ).toBe(false);
  });
});
