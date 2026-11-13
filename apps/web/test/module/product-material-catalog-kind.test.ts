import { describe, expect, it } from "vitest";
import type { MaterialPreview } from "../../src/entities/material";
import {
  catalogEntryMatchesKind,
  type CatalogEntry,
} from "../../src/_pages/library-discovery/ui/product-material-catalog.client";

function entry(material: Partial<MaterialPreview>): CatalogEntry {
  return {
    material: {
      access: "free",
      availability: "available",
      format: "Урок",
      productMemberships: [],
      slug: "lesson",
      summary: "",
      tags: [],
      title: "Урок",
      topic: "",
      topicSlug: "",
      ...material,
    },
    inProgramme: true,
    place: null,
    topicId: null,
  };
}

describe("product material catalogue kind filter", () => {
  // Уроки курса бывают в формате «Урок» с роликом: карточка рисует их как видео.
  it("treats a lesson with a primary video as a video, like its card does", () => {
    const lesson = entry({
      formatSlug: "lesson",
      primaryVideoDurationSeconds: 600,
    });
    expect(catalogEntryMatchesKind(lesson, "video")).toBe(true);
    expect(catalogEntryMatchesKind(lesson, "text")).toBe(false);
  });

  it("keeps a material of the video format among videos", () => {
    const video = entry({ formatSlug: "video" });
    expect(catalogEntryMatchesKind(video, "video")).toBe(true);
    expect(catalogEntryMatchesKind(video, "text")).toBe(false);
  });

  it("keeps a text material among texts", () => {
    const guide = entry({ formatSlug: "guide" });
    expect(catalogEntryMatchesKind(guide, "video")).toBe(false);
    expect(catalogEntryMatchesKind(guide, "text")).toBe(true);
    expect(catalogEntryMatchesKind(guide, "all")).toBe(true);
  });
});
