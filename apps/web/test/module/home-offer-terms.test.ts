import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HomePinnedCollection,
  HomeResult,
} from "@/_pages/home/model/home-view";

const fakes = vi.hoisted(() => ({ readTerms: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/features/billing-checkout.terms.server", () => ({
  readPublicProductOfferTerms: fakes.readTerms,
}));
vi.mock("@/_pages/home/api/public-home.public-cache.server", () => ({
  readPublicHome: vi.fn(),
}));

const pinned: HomePinnedCollection = {
  count: 3,
  cover: null,
  id: "00000000-0000-4000-8000-000000000780",
  name: "AI Engineering",
  previewItems: [],
  slug: "ai-engineering",
  summary: null,
  presentation: "default",
  card: {
    eyebrow: "Доступ {access_term}",
    subtitle: "Поддержка {support_term}",
    action: "Открыть",
  },
  hero: null,
};

function home(pinnedSeries: HomePinnedCollection): HomeResult {
  return {
    kind: "ready",
    value: {
      pinnedSeries,
      membership: { kind: "notOffered" },
      guides: [],
      notes: [],
      playlists: [],
      topics: [],
      videos: [],
    },
  };
}

async function fill(result: HomeResult) {
  const { fillPinnedOfferTerms } =
    await import("@/_pages/home/api/home-with-offer-terms.server");
  return fillPinnedOfferTerms(result);
}

function cardOf(result: HomeResult) {
  if (result.kind !== "ready") throw new Error("Expected a ready home");
  return result.value.pinnedSeries?.card;
}

describe("pinned product texts on the home page", () => {
  beforeEach(() => {
    fakes.readTerms.mockReset();
  });

  it("carry the terms of the product offer instead of placeholders", async () => {
    fakes.readTerms.mockResolvedValue({
      kind: "ready",
      terms: { materialsMonths: null, chatMonths: null, supportMonths: 6 },
    });

    expect(cardOf(await fill(home(pinned)))).toEqual({
      eyebrow: "Доступ без ограничения срока",
      subtitle: "Поддержка 6 месяцев",
      action: "Открыть",
    });
    expect(fakes.readTerms).toHaveBeenCalledWith(pinned.id);
  });

  it.each([
    ["the product is not on sale", { kind: "ready", terms: null }],
    ["the offer read failed", { kind: "unavailable" }],
  ])("name no term when %s", async (_name, read) => {
    fakes.readTerms.mockResolvedValue(read);

    expect(cardOf(await fill(home(pinned)))?.subtitle).toBe(
      "Поддержка по условиям предложения",
    );
  });

  it("do not read the offer of a product without authored texts", async () => {
    const result = home({ ...pinned, card: null });

    expect(await fill(result)).toBe(result);
    expect(fakes.readTerms).not.toHaveBeenCalled();
  });
});
