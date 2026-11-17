import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";

import * as optionalSession from "@/shared/auth/optional-platform-access-token.server";
let sessionReads: MockInstance<
  typeof optionalSession.getOptionalPlatformAccessToken
>;
import { catalogBackend } from "../support/catalog-backend";
let catalog: ReturnType<typeof catalogBackend>;

import {
  readGuestProductSale,
  readViewerProductSale,
} from "@/entities/subscription.sale.server";

const productId = productWithSupportOffer.product?.id;
if (productId === undefined)
  throw new Error("Missing canonical offered product");
const ok = (body: unknown) => Response.json(body);
beforeEach(() => {
  catalog = catalogBackend();
  catalog.prices.mockImplementation(() =>
    Promise.resolve(ok({ items: [productWithSupportOffer], nextCursor: null })),
  );
  catalog.sales.mockImplementation(() =>
    Promise.resolve(ok({ items: [], nextCursor: null })),
  );
  catalog.access.mockImplementation(() =>
    Promise.resolve(ok({ access: "open" })),
  );
  sessionReads = vi.spyOn(optionalSession, "getOptionalPlatformAccessToken");
});

afterEach(() => {
  expect(sessionReads).not.toHaveBeenCalled();
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
  expectPricesRequest(0);
  expect(sessionReads).not.toHaveBeenCalled();
  expect(catalog.access).not.toHaveBeenCalled();
});

it("passes the explicit viewer identity and keeps personal access out of the guest answer", async () => {
  expect(await readViewerProductSale(productId, "viewer-token")).toMatchObject({
    kind: "ready",
    access: "open",
    signedIn: true,
  });
  expectPricesRequest(0, "viewer-token");
  const accessRequest = catalog.access.mock.calls[0]?.[0];
  expect(accessRequest?.url).toBe(
    `https://platform-api.example.test/accounts/current/products/${productId}/access`,
  );
  expect(accessRequest?.headers.get("authorization")).toBe(
    "Bearer viewer-token",
  );
  expect(await readGuestProductSale(productId)).toMatchObject({
    access: "closed",
    signedIn: false,
  });
  expectPricesRequest(catalog.prices.mock.calls.length - 1);
  expect(sessionReads).not.toHaveBeenCalled();
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
    catalog.prices.mockImplementation(() =>
      Promise.resolve(ok({ items: offers, nextCursor: null })),
    );
    if (!cohortKnown)
      catalog.sales.mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 503 })),
      );
    if (access === "unknown")
      catalog.access.mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 503 })),
      );
    if (access === "closed")
      catalog.access.mockImplementation(() =>
        Promise.resolve(ok({ access: "closed" })),
      );
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
  catalog.prices.mockImplementation(() =>
    Promise.resolve(
      ok({ items: [productWithSupportOffer, subscription], nextCursor: null }),
    ),
  );
  expect(await readViewerProductSale(productId, "invited-token")).toMatchObject(
    {
      kind: "ready",
      offers: [subscription, productWithSupportOffer],
    },
  );
});

it("reports a catalog failure instead of an unsold product", async () => {
  catalog.prices.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 503 })),
  );
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
  expectPricesRequest(catalog.prices.mock.calls.length - 1);
  expect(sessionReads).not.toHaveBeenCalled();
});

it("orders offers across catalog pages rather than truncating the guest terms", async () => {
  const cheaper = { ...productWithSupportOffer, firstPriceKopecks: 10_000 };
  const cursor = "00000000-0000-4000-8000-000000000001";
  catalog.prices
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
    catalog.sales.mockImplementation(() =>
      Promise.resolve(ok({ items: [cohort], nextCursor: null })),
    );
    expect(await readGuestProductSale(productId)).toMatchObject({
      kind: "ready",
      cohort,
      cohortKnown: true,
    });
  },
);

it("reports an incomplete catalog as unavailable rather than publishing partial terms", async () => {
  catalog.prices.mockImplementation(() =>
    Promise.resolve(
      ok({
        items: [productWithSupportOffer],
        nextCursor: "00000000-0000-4000-8000-000000000001",
      }),
    ),
  );
  expect(await readGuestProductSale(productId)).toEqual({
    kind: "unavailable",
  });
});

function expectPricesRequest(index: number, token?: string) {
  const request = catalog.prices.mock.calls[index]?.[0];
  if (request === undefined)
    throw new Error("Expected catalogue price request");
  const url = new URL(request.url);
  expect(url.origin + url.pathname).toBe(
    "https://platform-api.example.test/billing/product-prices",
  );
  expect(Object.fromEntries(url.searchParams)).toEqual({
    productId,
    limit: "50",
  });
  expect(request.headers.get("authorization")).toBe(
    token === undefined ? null : `Bearer ${token}`,
  );
}
