import { beforeEach, expect, it, vi } from "vitest";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const boundary = vi.hoisted(() => ({
  offers: vi.fn(),
  cohorts: vi.fn(),
  access: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestBillingOffers: boundary.offers,
  requestProductCohorts: boundary.cohorts,
  requestProductAccess: boundary.access,
}));
vi.mock("@/shared/auth/index.server", () => ({
  getOptionalPlatformAccessToken: vi.fn(),
}));
import { readPublicProductOfferTerms } from "@/features/billing-checkout.terms.server";

const productId = "00000000-0000-4000-8000-000000000f01";
beforeEach(() => {
  vi.resetAllMocks();
  boundary.cohorts.mockResolvedValue({
    ok: true,
    body: { items: [], nextCursor: null },
  });
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
  boundary.offers.mockResolvedValue({
    ok: true,
    body: { items: [expensive, productWithSupportOffer], nextCursor: null },
  });
  await expect(readPublicProductOfferTerms(productId)).resolves.toEqual({
    kind: "ready",
    terms: { materialsMonths: null, chatMonths: undefined, supportMonths: 3 },
  });
  expect(boundary.offers).toHaveBeenCalledExactlyOnceWith(
    { capability: `product:${productId}`, limit: 50 },
    undefined,
  );
  expect(boundary.cohorts).not.toHaveBeenCalled();
  expect(boundary.access).not.toHaveBeenCalled();
});

it("keeps an exhausted empty sale distinct from an unavailable catalogue", async () => {
  boundary.offers
    .mockResolvedValueOnce({ ok: true, body: { items: [], nextCursor: null } })
    .mockResolvedValueOnce({ ok: false });
  await expect(readPublicProductOfferTerms(productId)).resolves.toEqual({
    kind: "ready",
    terms: null,
  });
  await expect(readPublicProductOfferTerms(productId)).resolves.toEqual({
    kind: "unavailable",
  });
  expect(boundary.cohorts).not.toHaveBeenCalled();
});
