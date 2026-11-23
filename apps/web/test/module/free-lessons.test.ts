import { describe, expect, it } from "vitest";

import type { MaterialPreview } from "@/entities/material";
import {
  countFreeLessons,
  firstFreeLessonHref,
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

  it("ведёт гостя прямо в первый урок программы и возвращает в программу к нему", () => {
    expect(
      firstFreeLessonHref({
        slug: "ai-engineering",
        items: [
          lesson("choose-agent", "free", "locked"),
          lesson("intro", "free", "locked"),
        ],
        programmePlacements: [
          placement("intro", "p-1"),
          placement("choose-agent", "p-2"),
        ],
      }),
    ).toBe(
      "/materials/intro?from=%2Fproducts%2Fai-engineering%2Fprogramme%3Fpage%3D1%26at%3Dintro&placement=p-1",
    );
  });

  it("не ведёт в урок, если первый урок программы закрыт или его доступ не проверен", () => {
    for (const first of [
      lesson("intro", "closed", "locked"),
      lesson("intro", "free", "unavailable"),
    ])
      expect(
        firstFreeLessonHref({
          slug: "ai-engineering",
          items: [first, lesson("next", "free", "locked")],
          programmePlacements: [
            placement("intro", "p-1"),
            placement("next", "p-2"),
          ],
        }),
      ).toBeUndefined();
  });

  it("не выбирает урок, когда порядок программы неизвестен", () => {
    expect(
      firstFreeLessonHref({
        slug: "ai-engineering",
        items: [lesson("intro", "free", "locked")],
        programmePlacements: undefined,
      }),
    ).toBeUndefined();
  });
});
