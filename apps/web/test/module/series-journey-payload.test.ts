import type { ComponentProps, ReactElement } from "react";
import type { Route } from "next";
import { describe, expect, it } from "vitest";

import { SeriesJourney } from "@/_pages/library-discovery/ui/series-journey";
import type { SeriesJourneyControls } from "@/_pages/library-discovery/ui/series-journey-controls.client";
import type { MaterialPreview } from "@/entities/material";

describe("Product programme presentation payload", () => {
  it("keeps the complete programme without sending a second rendered catalogue for 120 Materials", () => {
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
    const journey: ReactElement<ComponentProps<typeof SeriesJourneyControls>> =
      SeriesJourney({
        currentHref: "/products/platform-inside/programme" as Route,
        result: {
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
        },
      });
    const programme = journey.props.parts.find(
      (part) => part.kind === "materials",
    );
    const catalogue = journey.props.parts.find(
      (part) => part.kind === "catalog",
    );
    expect(programme?.runs.flatMap((run) => run.rows)).toHaveLength(120);
    expect(catalogue?.entries).toHaveLength(120);
    const serialized = JSON.stringify(journey.props);
    const renderedCatalogueCards =
      serialized.match(/"variant":"feed"/gu)?.length ?? 0;
    console.info({
      corpus: 120,
      presentationPropsBytes: Buffer.byteLength(serialized),
      renderedCatalogueCards,
    });
    expect(renderedCatalogueCards).toBe(0);
  });
});
