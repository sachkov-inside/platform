import type { MaterialPreview } from "@/entities/material";
import type { PublishedSeriesResult } from "@/features/library-discovery";

/** Один детерминированный состав для programme/catalogue evidence на 120 материалах. */
export function seriesJourneyCorpus(): Extract<
  PublishedSeriesResult,
  { kind: "ready" }
> {
  const items = Array.from({ length: 120 }, (_, index): MaterialPreview => ({
    materialId: `material-${String(index + 1)}`,
    slug: `material-${String(index + 1)}`,
    title: `Урок ${String(index + 1)}`,
    summary: `Описание материала ${String(index + 1)}`,
    access: index < 3 ? "free" : "closed",
    availability: index < 3 ? "available" : "locked",
    format: index % 2 === 0 ? "Видео" : "Гайд",
    formatSlug: index % 2 === 0 ? "video" : "guide",
    publishedAt: "2026-10-01T12:00:00.000Z",
    topic: "Platform",
    topicSlug: "platform",
    tags: [],
    seriesMemberships: [],
  }));
  return {
    kind: "ready",
    discoveryKind: "series",
    chapters: [],
    hasNext: false,
    reference: {
      name: "Platform",
      slug: "platform-inside",
      summary: "От идеи до выпуска",
    },
    items,
    relatedSeries: [],
    topics: [],
  };
}
