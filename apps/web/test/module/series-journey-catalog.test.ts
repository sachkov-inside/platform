import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SeriesJourney } from "@/_pages/library-discovery/ui/series-journey";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { seriesJourneyCorpus } from "@/storybook/series-journey-corpus.fixtures";

const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ refresh: vi.fn() }),
}));

beforeEach(() => {
  navigation.search = "part=materials";
});

function renderCatalogue() {
  return renderToString(
    createElement(SeriesJourney, {
      currentHref: productProgrammeHref("platform-inside"),
      result: seriesJourneyCorpus(),
    }),
  );
}

describe("Product catalogue presentation", () => {
  it("opens a batch of 12 cards while retaining the total of 120 Materials", () => {
    const html = renderCatalogue();
    expect(html.match(/data-material-variant="feed"/gu)).toHaveLength(12);
    expect(html).toContain("120 материалов");
    expect(html).toContain("Показать ещё материалы");
  });

  it("restores a Reader return outside the first batch with its catalogue address", () => {
    navigation.search = "part=materials&at=material-89";
    const html = renderCatalogue();
    expect(html.match(/data-material-variant="feed"/gu)).toHaveLength(96);
    expect(html).toContain('data-route-material="material-89"');
    expect(html).toContain("part%3Dmaterials%26at%3Dmaterial-89");
    expect(html).not.toContain('data-route-material="material-97"');
  });
});
