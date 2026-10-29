import { describe, expect, it } from "vitest";

import type { MaterialPreview } from "@/entities/material";
import { freeLessons } from "@/_pages/library-discovery/model/free-lessons";

function lesson(
  slug: string,
  access: "free" | "closed",
  availability: "available" | "locked" | "unavailable" = access === "free"
    ? "available"
    : "locked",
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

describe("бесплатные уроки на странице курса", () => {
  it("идут в порядке программы и ведут в урок с возвратом в программу", () => {
    const lessons = freeLessons({
      slug: "ai-engineering",
      items: [lesson("choose-agent", "free"), lesson("intro", "free")],
      chapters: [{ materialIds: ["material-intro", "material-choose-agent"] }],
    });
    expect(lessons.map(({ title, href }) => ({ title, href }))).toEqual([
      {
        title: "Урок intro",
        href: "/materials/intro?from=%2Fproducts%2Fai-engineering%2Fprogramme",
      },
      {
        title: "Урок choose-agent",
        href: "/materials/choose-agent?from=%2Fproducts%2Fai-engineering%2Fprogramme",
      },
    ]);
  });

  it("не включают закрытые уроки и бесплатные, доступ к которым не удалось проверить", () => {
    expect(
      freeLessons({
        slug: "ai-engineering",
        items: [
          lesson("intro", "free"),
          lesson("first-version", "closed"),
          lesson("unchecked", "free", "unavailable"),
        ],
        chapters: [],
      }).map(({ title }) => title),
    ).toEqual(["Урок intro"]);
  });

  it("включают бесплатный урок, который гостю откроется после входа (#1825)", () => {
    expect(
      freeLessons({
        slug: "ai-engineering",
        items: [lesson("intro", "free", "locked")],
        chapters: [],
      }).map(({ title }) => title),
    ).toEqual(["Урок intro"]);
  });

  it("следуют размещениям программы и не считают уроками дополнительные материалы", () => {
    expect(
      freeLessons({
        slug: "ai-engineering",
        items: [
          lesson("brief", "free"),
          lesson("intro", "free"),
          lesson("choose-agent", "free"),
        ],
        chapters: [
          { materialIds: ["material-intro", "material-choose-agent"] },
        ],
        programmePlacements: [
          { materialId: "material-choose-agent" },
          { materialId: "material-intro" },
        ],
      }).map(({ title }) => title),
    ).toEqual(["Урок choose-agent", "Урок intro"]);
  });
});
