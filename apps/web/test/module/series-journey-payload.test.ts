import type { ComponentProps, ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { SeriesJourney } from "@/_pages/library-discovery/ui/series-journey";
import type { SeriesJourneyControls } from "@/_pages/library-discovery/ui/series-journey-controls.client";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { seriesJourneyCorpus } from "@/storybook/series-journey-corpus.fixtures";

describe("Product programme presentation payload", () => {
  it("keeps the complete programme without sending a second rendered catalogue for 120 Materials", () => {
    const journey: ReactElement<ComponentProps<typeof SeriesJourneyControls>> =
      SeriesJourney({
        currentHref: productProgrammeHref("platform-inside"),
        result: seriesJourneyCorpus(),
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
