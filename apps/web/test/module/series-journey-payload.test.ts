import type { ComponentProps, ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ProductJourney } from "@/_pages/library-discovery/ui/product-journey";
import type { ProductJourneyControls } from "@/_pages/library-discovery/ui/product-journey-controls.client";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { productJourneyCorpus } from "@/storybook/product-journey-corpus.fixtures";

describe("Product programme presentation payload", () => {
  it("keeps the complete programme without sending a second rendered catalogue for 120 Materials", () => {
    const journey: ReactElement<ComponentProps<typeof ProductJourneyControls>> =
      ProductJourney({
        currentHref: productProgrammeHref("platform-inside"),
        result: productJourneyCorpus(),
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
