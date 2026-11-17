import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { realBffSession } from "../support/real-bff-session";
import { ownerBillingBackend } from "../support/owner-billing-backend";
let backend: ReturnType<typeof ownerBillingBackend>;
let session: Awaited<ReturnType<typeof realBffSession>>;

import { handleOwnerPriceCatalogRead } from "@/entities/subscription.server";
import { OWNER_PRICE_CATALOG_PAGE_BUDGET } from "@/entities/subscription/model/owner-price-catalog";
import {
  handleCreatePaymentLink,
  handleListPaymentLinks,
  handleRevokePaymentLink,
} from "@/features/payment-links.server";
import {
  handleArchivePromotion,
  handleListPromotions,
  handleQuestionnaireRespondents,
  handleSavePromotion,
} from "@/features/promotions.server";

const origin = "https://inside.example.test";
const operationId = "20000000-0000-4000-8000-000000001801";
const productId = "00000000-0000-4000-8000-000000001802";
const linkId = "00000000-0000-4000-8000-000000001803";
const promotionId = "00000000-0000-4000-8000-000000001804";
const cursor = "00000000-0000-4000-8000-000000001805";

function command(url: string, input: unknown): Request {
  return new Request(`${origin}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(input),
  });
}
const ok = (body: unknown) => Response.json(body);
const problem = (code: string, status: number) =>
  Response.json({ code }, { status });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession("owner-token");
  backend = ownerBillingBackend();
});

afterEach(() => vi.useRealTimers());

it("forwards the product and state filter of the payment links list", async () => {
  backend.command.mockImplementation(() =>
    Promise.resolve(
      ok({
        operationRef: operationId,
        result: { outcome: "paymentLinks", items: [], nextCursor: null },
      }),
    ),
  );
  const response = await session(() =>
    handleListPaymentLinks(
      command("/api/authoring/billing/payment-links/list", {
        operationId,
        limit: 30,
        productId,
        state: "active",
        cursor,
      }),
    ),
  );
  expect(await response.json()).toMatchObject({ ok: true });
  expect(await commandBody(backend.command.mock.calls.at(-1)?.[0])).toEqual({
    operation: "paymentLinks.list",
    operationId,
    limit: 30,
    productId,
    state: "active",
    cursor,
  });
});

it("creates a link with the price revision and revokes with the expected revision", async () => {
  backend.command.mockImplementation(() =>
    Promise.resolve(problem("revision_conflict", 409)),
  );
  const created = await session(() =>
    handleCreatePaymentLink(
      command("/api/authoring/billing/payment-links/create", {
        operationId,
        productId,
        priceRevision: 3,
        price: { kind: "discount", percent: 15 },
        expiresAt: "2026-11-16T00:00:00+03:00",
      }),
    ),
  );
  expect(await created.json()).toEqual({
    ok: false,
    code: "revision_conflict",
  });
  await session(() =>
    handleRevokePaymentLink(
      command("/api/authoring/billing/payment-links/revoke", {
        operationId,
        id: linkId,
        expectedRevision: 2,
      }),
    ),
  );
  expect(
    await Promise.all(
      backend.command.mock.calls.map(([request]) => commandBody(request)),
    ),
  ).toEqual([
    {
      operation: "paymentLinks.create",
      operationId,
      productId,
      priceRevision: 3,
      price: { kind: "discount", percent: 15 },
      expiresAt: "2026-11-16T00:00:00+03:00",
    },
    {
      operation: "paymentLinks.revoke",
      operationId,
      id: linkId,
      expectedRevision: 2,
    },
  ]);
});

it("refuses a payment link command that chooses its own billing operation", async () => {
  const response = await session(() =>
    handleCreatePaymentLink(
      command("/api/authoring/billing/payment-links/create", {
        operationId,
        productId,
        priceRevision: 3,
        price: { kind: "discount", percent: 15 },
        expiresAt: null,
        operation: "offers.publish",
      }),
    ),
  );
  expect(await response.json()).toMatchObject({
    ok: false,
    code: "invalid_request",
  });
  expect(backend.command).not.toHaveBeenCalled();
});

it("lists owner promotions without questionnaire ones unless asked", async () => {
  backend.command.mockImplementation(() =>
    Promise.resolve(
      ok({
        operationRef: operationId,
        result: { outcome: "promotions", items: [], nextCursor: null },
      }),
    ),
  );
  await session(() =>
    handleListPromotions(
      command("/api/authoring/billing/promotions/list", {
        operationId,
        limit: 50,
        archived: true,
        productId,
      }),
    ),
  );
  expect(await commandBody(backend.command.mock.calls.at(-1)?.[0])).toEqual({
    operation: "promotions.list",
    operationId,
    limit: 50,
    archived: true,
    questionnaire: false,
    productId,
  });
});

it("saves an edit with the list revision and archives with the expected revision", async () => {
  const catalog = ok({
    operationRef: operationId,
    result: {
      outcome: "catalog",
      value: { id: promotionId, revision: 5, archived: false },
    },
  });
  backend.command.mockImplementation(() => Promise.resolve(catalog.clone()));
  const value = {
    id: promotionId,
    name: "Осенняя скидка",
    percent: 20,
    code: null,
    startsAt: "2026-11-01T00:00:00+03:00",
    endsAt: "2026-12-01T00:00:00+03:00",
    productIds: [],
    usageLimit: null,
  };
  const saved = await session(() =>
    handleSavePromotion(
      command("/api/authoring/billing/promotions/save", {
        operationId,
        expectedRevision: 4,
        value,
      }),
    ),
  );
  expect(await saved.json()).toMatchObject({ ok: true });
  await session(() =>
    handleArchivePromotion(
      command("/api/authoring/billing/promotions/archive", {
        operationId,
        id: promotionId,
        expectedRevision: 5,
      }),
    ),
  );
  expect(
    await Promise.all(
      backend.command.mock.calls.map(([request]) => commandBody(request)),
    ),
  ).toEqual([
    {
      operation: "promotions.save",
      operationId,
      expectedRevision: 4,
      value,
    },
    {
      operation: "promotions.archive",
      operationId,
      id: promotionId,
      expectedRevision: 5,
    },
  ]);
});

it("keeps a refusal of the questionnaire archive a refusal, not an empty archive", async () => {
  backend.command.mockImplementation(() =>
    Promise.resolve(problem("forbidden", 403)),
  );
  const response = await session(() =>
    handleQuestionnaireRespondents(
      command("/api/authoring/billing/respondents/status", { operationId }),
    ),
  );
  expect(await response.json()).toEqual({ ok: false, code: "forbidden" });
});

it("reads every page of the owner price catalog and refuses for another role", async () => {
  const archivedProductId = "00000000-0000-4000-8000-000000001720";
  backend.command
    .mockResolvedValueOnce(
      ok({
        operationRef: operationId,
        result: {
          outcome: "catalogOffers",
          items: [],
          archivedProductIds: [archivedProductId],
          nextCursor: cursor,
        },
      }),
    )
    .mockResolvedValueOnce(
      ok({
        operationRef: operationId,
        result: { outcome: "catalogOffers", items: [], nextCursor: null },
      }),
    );
  const response = await session(() => handleOwnerPriceCatalogRead());
  // Архивные цены каждой страницы собираются в один каталог: архив окончателен, и экраны его видят.
  expect(await response.json()).toEqual({
    ok: true,
    value: { items: [], archivedProductIds: [archivedProductId] },
  });
  expect(
    await Promise.all(
      backend.command.mock.calls.map(([request]) => commandBody(request)),
    ),
  ).toEqual([
    expect.objectContaining({ operation: "productPrices.list", limit: 100 }),
    expect.objectContaining({ operation: "productPrices.list", cursor }),
  ]);

  backend.command.mockReset();
  backend.command.mockImplementation(() =>
    Promise.resolve(problem("forbidden", 403)),
  );
  const refused = await session(() => handleOwnerPriceCatalogRead());
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ ok: false, code: "forbidden" });
});

it("reads at most the page budget of the owner price catalog and reports the overflow as unavailable", async () => {
  backend.command.mockImplementation(() =>
    Promise.resolve(
      ok({
        operationRef: operationId,
        result: { outcome: "catalogOffers", items: [], nextCursor: cursor },
      }),
    ),
  );
  const response = await session(() => handleOwnerPriceCatalogRead());
  expect(backend.command).toHaveBeenCalledTimes(
    OWNER_PRICE_CATALOG_PAGE_BUDGET,
  );
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ ok: false, code: "unavailable" });
});

it("does not report an empty owner price catalog when a continuation fails", async () => {
  backend.command
    .mockResolvedValueOnce(
      ok({
        operationRef: operationId,
        result: { outcome: "catalogOffers", items: [], nextCursor: cursor },
      }),
    )
    .mockResolvedValueOnce(problem("dependency_unavailable", 503));
  const response = await session(() => handleOwnerPriceCatalogRead());
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("value");
});

it("keeps the owner price catalog private and unread without a session", async () => {
  backend.command.mockImplementation(() =>
    Promise.resolve(
      ok({
        operationRef: operationId,
        result: { outcome: "catalogOffers", items: [], nextCursor: null },
      }),
    ),
  );
  const response = await session(() => handleOwnerPriceCatalogRead());
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("vary")).toBe("cookie");

  backend.command.mockClear();
  session = await realBffSession(null);
  const signedOut = await session(() => handleOwnerPriceCatalogRead());
  expect(signedOut.status).toBe(401);
  expect(backend.command).not.toHaveBeenCalled();
});

async function commandBody(request: Request | undefined): Promise<unknown> {
  if (request === undefined)
    throw new Error("Expected owner Billing HTTP request");
  expect(request.headers.get("authorization")).toBe("Bearer owner-token");
  return request.clone().json();
}
