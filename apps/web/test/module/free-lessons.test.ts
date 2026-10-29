import { describe, expect, it } from "vitest";

import type { MaterialPreview } from "@/entities/material";
import { countFreeLessons } from "@/_pages/library-discovery/model/free-lessons";

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
