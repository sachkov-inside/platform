import { beforeEach, expect, it } from "vitest";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

import { catalogBackend } from "../support/catalog-backend";
let catalog: ReturnType<typeof catalogBackend>;

import { readPublicProductOfferTerms } from "@/features/billing-checkout.terms.server";

const productId = "00000000-0000-4000-8000-000000000f01";
beforeEach(() => {
  catalog = catalogBackend();
  catalog.sales.mockImplementation(() =>
    Promise.resolve(Response.json({ items: [], nextCursor: null })),
  );
});

it("reads only the public cheapest-offer terms; cohort and private access cannot change those terms", async () => {
  const expensive = {
    ...productWithSupportOffer,
    firstPriceKopecks: 600000,
    offer: {
      ...productWithSupportOffer.offer,
      benefitPeriods: [{ capability: "support", months: 12 }],
    },
  };
  catalog.prices.mockResolvedValueOnce(
    Response.json({
      items: [expensive, productWithSupportOffer],
      nextCursor: null,
    }),
  );
  await expect(readPublicProductOfferTerms(productId)).resolves.toEqual({
    kind: "ready",
    terms: { materialsMonths: null, chatMonths: null, supportMonths: 3 },
  });
  expect(catalog.prices).toHaveBeenCalledOnce();
  const sent = catalog.prices.mock.calls[0]?.[0];
  const url = new URL(sent?.url ?? "");
  expect(url.origin + url.pathname).toBe(
    "https://platform-api.example.test/billing/product-prices",
  );
  expect([...url.searchParams.entries()].sort()).toEqual([
    ["limit", "50"],
    ["productId", "00000000-0000-4000-8000-000000000f01"],
  ]);
  expect(sent?.headers.has("authorization")).toBe(false);
  expect(catalog.sales).not.toHaveBeenCalled();
  expect(catalog.access).not.toHaveBeenCalled();
});

it("keeps an exhausted empty sale distinct from an unavailable catalogue", async () => {
  catalog.prices
    .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(readPublicProductOfferTerms(productId)).resolves.toEqual({
    kind: "ready",
    terms: null,
  });
  await expect(readPublicProductOfferTerms(productId)).resolves.toEqual({
    kind: "unavailable",
  });
  expect(catalog.sales).not.toHaveBeenCalled();
});
