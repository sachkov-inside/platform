import { beforeEach, expect, it, vi } from "vitest";
import { guideWithSupportOffer } from "@/storybook/billing.fixtures";

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
  requestGuideCohorts: boundary.cohorts,
  requestGuideAccess: boundary.access,
}));
vi.mock("@/shared/auth/index.server", () => ({
  getOptionalPlatformAccessToken: boundary.session,
}));

import {
  readGuestGuideSale,
  readViewerGuideSale,
} from "@/entities/subscription.sale.server";

const guideId = guideWithSupportOffer.offer.benefits[0]?.slice(6) ?? "";
const ok = (body: unknown) => ({ ok: true, body });
beforeEach(() => {
  vi.resetAllMocks();
  boundary.offers.mockResolvedValue(
    ok({ items: [guideWithSupportOffer], nextCursor: null }),
  );
  boundary.cohorts.mockResolvedValue(ok({ items: [] }));
  boundary.access.mockResolvedValue(ok({ access: "open" }));
  boundary.session.mockRejectedValue(new Error("Session must not be read"));
});

it("reads a guest sale without a session or a personal access request", async () => {
  expect(await readGuestGuideSale(guideId)).toMatchObject({
    kind: "ready",
    sold: true,
    offers: [guideWithSupportOffer],
    cohort: null,
    access: "closed",
    signedIn: false,
    terms: { materialsMonths: null, chatMonths: null, supportMonths: 3 },
  });
  expect(boundary.offers).toHaveBeenCalledWith(
    { capability: `guide:${guideId}`, limit: 50 },
    undefined,
  );
  expect(boundary.session).not.toHaveBeenCalled();
  expect(boundary.access).not.toHaveBeenCalled();
});

it("passes the explicit viewer identity and keeps personal access out of the guest answer", async () => {
  expect(await readViewerGuideSale(guideId, "viewer-token")).toMatchObject({
    kind: "ready",
    access: "open",
    signedIn: true,
  });
  expect(boundary.offers).toHaveBeenCalledWith(
    { capability: `guide:${guideId}`, limit: 50 },
    "viewer-token",
  );
  expect(boundary.access).toHaveBeenCalledWith(guideId, "viewer-token");
  expect(await readGuestGuideSale(guideId)).toMatchObject({
    access: "closed",
    signedIn: false,
  });
  expect(boundary.session).not.toHaveBeenCalled();
});

it.each([
  ["no sale", [], true, "closed", false],
  [
    "access could not be confirmed",
    [guideWithSupportOffer],
    true,
    "unknown",
    true,
  ],
  ["cohort could not be read", [guideWithSupportOffer], false, "open", true],
] as const)(
  "reports %s without inventing a stage or access",
  async (_name, offers, cohortKnown, access, sold) => {
    boundary.offers.mockResolvedValue(ok({ items: offers, nextCursor: null }));
    if (!cohortKnown) boundary.cohorts.mockResolvedValue({ ok: false });
    if (access === "unknown") boundary.access.mockResolvedValue({ ok: false });
    if (access === "closed")
      boundary.access.mockResolvedValue(ok({ access: "closed" }));
    expect(await readViewerGuideSale(guideId, "viewer-token")).toMatchObject({
      kind: "ready",
      sold,
      cohortKnown,
      access,
    });
  },
);

it("keeps subscriptions for a product and orders all payment variants by price", async () => {
  const subscription = {
    ...guideWithSupportOffer,
    firstPriceKopecks: 50_000,
    paymentOption: {
      ...guideWithSupportOffer.paymentOption,
      mode: "subscription",
    },
  };
  boundary.offers.mockResolvedValue(
    ok({ items: [guideWithSupportOffer, subscription], nextCursor: null }),
  );
  expect(await readViewerGuideSale(guideId, "invited-token")).toMatchObject({
    kind: "ready",
    offers: [subscription, guideWithSupportOffer],
  });
});

it("reports a catalog failure instead of an unsold product", async () => {
  boundary.offers.mockResolvedValue({ ok: false });
  expect(await readGuestGuideSale(guideId)).toEqual({ kind: "unavailable" });
});

it("caches only the guest terms after a personal sale read", async () => {
  await readViewerGuideSale(guideId, "viewer-token");
  const { readPublicGuideOfferTerms } =
    await import("@/features/billing-checkout.terms.server");
  expect(await readPublicGuideOfferTerms(guideId)).toEqual({
    kind: "ready",
    terms: { materialsMonths: null, chatMonths: null, supportMonths: 3 },
  });
  expect(boundary.offers).toHaveBeenLastCalledWith(
    { capability: `guide:${guideId}`, limit: 50 },
    undefined,
  );
  expect(boundary.session).not.toHaveBeenCalled();
});

it("orders offers across catalog pages rather than truncating the guest terms", async () => {
  const cheaper = { ...guideWithSupportOffer, firstPriceKopecks: 10_000 };
  const cursor = "00000000-0000-4000-8000-000000000001";
  boundary.offers
    .mockResolvedValueOnce(
      ok({ items: [guideWithSupportOffer], nextCursor: cursor }),
    )
    .mockResolvedValueOnce(ok({ items: [cheaper], nextCursor: null }));
  expect(await readGuestGuideSale(guideId)).toMatchObject({
    kind: "ready",
    offers: [cheaper, guideWithSupportOffer],
  });
});

it.each(["announcement", "preorder", "running", "between"] as const)(
  "returns the current cohort stage %s from the same sale",
  async (stage) => {
    const cohort = {
      guideId,
      name: "First cohort",
      revision: 1,
      stage,
      startsOn: null,
      nextEvent: "Next lesson",
    };
    boundary.cohorts.mockResolvedValue(ok({ items: [cohort] }));
    expect(await readGuestGuideSale(guideId)).toMatchObject({
      kind: "ready",
      cohort,
      cohortKnown: true,
    });
  },
);

it("reports an incomplete catalog as unavailable rather than publishing partial terms", async () => {
  boundary.offers.mockResolvedValue(
    ok({
      items: [guideWithSupportOffer],
      nextCursor: "00000000-0000-4000-8000-000000000001",
    }),
  );
  expect(await readGuestGuideSale(guideId)).toEqual({ kind: "unavailable" });
});
