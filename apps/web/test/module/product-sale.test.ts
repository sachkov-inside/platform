import { productIdFromCapability } from "@inside/access-capabilities";
import { beforeEach, expect, it, vi } from "vitest";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

const boundary = vi.hoisted(() => ({
  offers: vi.fn(),
  cohorts: vi.fn(),
  access: vi.fn(),
  session: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestBillingOffers: boundary.offers,
  requestProductCohorts: boundary.cohorts,
  requestProductAccess: boundary.access,
}));
vi.mock("@/shared/auth/index.server", () => ({
  getOptionalPlatformAccessToken: boundary.session,
}));

import {
  readGuestProductSale,
  readViewerProductSale,
} from "@/entities/subscription.sale.server";

const capability = productWithSupportOffer.offer.benefits[0];
const productId =
  capability === undefined ? "" : (productIdFromCapability(capability) ?? "");
const ok = (body: unknown) => ({ ok: true, body });
beforeEach(() => {
  vi.resetAllMocks();
  boundary.offers.mockResolvedValue(
    ok({ items: [productWithSupportOffer], nextCursor: null }),
  );
  boundary.cohorts.mockResolvedValue(ok({ items: [] }));
  boundary.access.mockResolvedValue(ok({ access: "open" }));
  boundary.session.mockRejectedValue(new Error("Session must not be read"));
});

it("reads a guest sale without a session or a personal access request", async () => {
  expect(await readGuestProductSale(productId)).toMatchObject({
    kind: "ready",
    sold: true,
    offers: [productWithSupportOffer],
    cohort: null,
    access: "closed",
    signedIn: false,
    terms: { materialsMonths: null, chatMonths: null, supportMonths: 3 },
  });
  expect(boundary.offers).toHaveBeenCalledWith(
    { capability: `product:${productId}`, limit: 50 },
    undefined,
  );
  expect(boundary.session).not.toHaveBeenCalled();
  expect(boundary.access).not.toHaveBeenCalled();
});

it("passes the explicit viewer identity and keeps personal access out of the guest answer", async () => {
  expect(await readViewerProductSale(productId, "viewer-token")).toMatchObject({
    kind: "ready",
    access: "open",
    signedIn: true,
  });
  expect(boundary.offers).toHaveBeenCalledWith(
    { capability: `product:${productId}`, limit: 50 },
    "viewer-token",
  );
  expect(boundary.access).toHaveBeenCalledWith(productId, "viewer-token");
  expect(await readGuestProductSale(productId)).toMatchObject({
    access: "closed",
    signedIn: false,
  });
  expect(boundary.session).not.toHaveBeenCalled();
});

it.each([
  ["no sale", [], true, "closed", false],
  [
    "access could not be confirmed",
    [productWithSupportOffer],
    true,
    "unknown",
    true,
  ],
  ["cohort could not be read", [productWithSupportOffer], false, "open", true],
] as const)(
  "reports %s without inventing a stage or access",
  async (_name, offers, cohortKnown, access, sold) => {
    boundary.offers.mockResolvedValue(ok({ items: offers, nextCursor: null }));
    if (!cohortKnown) boundary.cohorts.mockResolvedValue({ ok: false });
    if (access === "unknown") boundary.access.mockResolvedValue({ ok: false });
    if (access === "closed")
      boundary.access.mockResolvedValue(ok({ access: "closed" }));
    expect(
      await readViewerProductSale(productId, "viewer-token"),
    ).toMatchObject({
      kind: "ready",
      sold,
      cohortKnown,
      access,
    });
  },
);

it("keeps subscriptions for a product and orders all payment variants by price", async () => {
  const subscription = {
    ...productWithSupportOffer,
    firstPriceKopecks: 50_000,
    paymentOption: {
      ...productWithSupportOffer.paymentOption,
      mode: "subscription",
    },
  };
  boundary.offers.mockResolvedValue(
    ok({ items: [productWithSupportOffer, subscription], nextCursor: null }),
  );
  expect(await readViewerProductSale(productId, "invited-token")).toMatchObject(
    {
      kind: "ready",
      offers: [subscription, productWithSupportOffer],
    },
  );
});

it("reports a catalog failure instead of an unsold product", async () => {
  boundary.offers.mockResolvedValue({ ok: false });
  expect(await readGuestProductSale(productId)).toEqual({
    kind: "unavailable",
  });
});

it("caches only the guest terms after a personal sale read", async () => {
  await readViewerProductSale(productId, "viewer-token");
  const { readPublicProductOfferTerms } =
    await import("@/features/billing-checkout.terms.server");
  expect(await readPublicProductOfferTerms(productId)).toEqual({
    kind: "ready",
    terms: { materialsMonths: null, chatMonths: null, supportMonths: 3 },
  });
  expect(boundary.offers).toHaveBeenLastCalledWith(
    { capability: `product:${productId}`, limit: 50 },
    undefined,
  );
  expect(boundary.session).not.toHaveBeenCalled();
});

it("orders offers across catalog pages rather than truncating the guest terms", async () => {
  const cheaper = { ...productWithSupportOffer, firstPriceKopecks: 10_000 };
  const cursor = "00000000-0000-4000-8000-000000000001";
  boundary.offers
    .mockResolvedValueOnce(
      ok({ items: [productWithSupportOffer], nextCursor: cursor }),
    )
    .mockResolvedValueOnce(ok({ items: [cheaper], nextCursor: null }));
  expect(await readGuestProductSale(productId)).toMatchObject({
    kind: "ready",
    offers: [cheaper, productWithSupportOffer],
  });
});

it.each(["announcement", "preorder", "running", "between"] as const)(
  "returns the current cohort stage %s from the same sale",
  async (stage) => {
    const cohort = {
      productId,
      name: "First cohort",
      revision: 1,
      stage,
      startsOn: null,
      nextEvent: "Next lesson",
    };
    boundary.cohorts.mockResolvedValue(ok({ items: [cohort] }));
    expect(await readGuestProductSale(productId)).toMatchObject({
      kind: "ready",
      cohort,
      cohortKnown: true,
    });
  },
);

it("reports an incomplete catalog as unavailable rather than publishing partial terms", async () => {
  boundary.offers.mockResolvedValue(
    ok({
      items: [productWithSupportOffer],
      nextCursor: "00000000-0000-4000-8000-000000000001",
    }),
  );
  expect(await readGuestProductSale(productId)).toEqual({
    kind: "unavailable",
  });
});
