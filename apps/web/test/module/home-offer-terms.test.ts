import { beforeEach, describe, expect, it } from "vitest";

import type {
  HomePinnedCollection,
  HomeResult,
} from "@/_pages/home/model/home-view";

import { productWithSupportOffer } from "@/storybook/billing.fixtures";
import { catalogBackend } from "../support/catalog-backend";
let catalog: ReturnType<typeof catalogBackend>;

const pinned: HomePinnedCollection = {
  count: 3,
  cover: null,
  id: "00000000-0000-4000-8000-000000000f01",
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

function home(pinnedProduct: HomePinnedCollection): HomeResult {
  return {
    kind: "ready",
    value: {
      pinnedProduct,
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
  return result.value.pinnedProduct?.card;
}

describe("pinned product texts on the home page", () => {
  beforeEach(() => {
    catalog = catalogBackend();
  });

  it("carry the terms of the product offer instead of placeholders", async () => {
    catalog.prices.mockResolvedValueOnce(
      Response.json({ items: [productWithSupportOffer], nextCursor: null }),
    );

    expect(cardOf(await fill(home(pinned)))).toEqual({
      eyebrow: "Доступ без ограничения срока",
      subtitle: "Поддержка по условиям оферты",
      action: "Открыть",
    });
    expect(catalog.prices).toHaveBeenCalledOnce();
    const sent = catalog.prices.mock.calls[0]?.[0];
    expect(new URL(sent?.url ?? "").searchParams.get("productId")).toBe(
      "00000000-0000-4000-8000-000000000f01",
    );
    expect(sent?.headers.has("authorization")).toBe(false);
  });

  it.each([
    ["the product is not on sale", 200],
    ["the offer read failed", 503],
  ])("name no term when %s", async (_name, status) => {
    catalog.prices.mockResolvedValueOnce(
      status === 200
        ? Response.json({ items: [], nextCursor: null })
        : new Response(null, { status }),
    );

    expect(cardOf(await fill(home(pinned)))?.subtitle).toBe(
      "Поддержка по условиям предложения",
    );
  });

  it("do not read the offer of a product without authored texts", async () => {
    const result = home({ ...pinned, card: null });

    expect(await fill(result)).toBe(result);
    expect(catalog.fetch).not.toHaveBeenCalled();
  });
});
