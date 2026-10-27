import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn<() => Promise<string>>(),
  manage: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestManageBilling: fakes.manage,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: (): Promise<string> => fakes.token(),
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));

import { handleOwnerPriceCatalogRead } from "@/entities/subscription.server";
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
const ok = (body: unknown) => ({ ok: true, body, response: new Response() });
const problem = (code: string, status: number) => ({
  ok: false,
  problem: { code },
  response: new Response(null, { status }),
});

beforeEach(() => {
  vi.resetAllMocks();
  fakes.token.mockResolvedValue("owner-token");
});

it("forwards the product and state filter of the payment links list", async () => {
  fakes.manage.mockResolvedValue(
    ok({
      operationRef: operationId,
      result: { outcome: "paymentLinks", items: [], nextCursor: null },
    }),
  );
  const response = await handleListPaymentLinks(
    command("/api/authoring/billing/payment-links/list", {
      operationId,
      limit: 30,
      productId,
      state: "active",
      cursor,
    }),
  );
  expect(await response.json()).toMatchObject({ ok: true });
  expect(fakes.manage).toHaveBeenCalledWith(
    {
      operation: "paymentLinks.list",
      operationId,
      limit: 30,
      productId,
      state: "active",
      cursor,
    },
    "owner-token",
    {},
  );
});

it("creates a link with the price revision and revokes with the expected revision", async () => {
  fakes.manage.mockResolvedValue(problem("revision_conflict", 409));
  const created = await handleCreatePaymentLink(
    command("/api/authoring/billing/payment-links/create", {
      operationId,
      productId,
      priceRevision: 3,
      price: { kind: "discount", percent: 15 },
      expiresAt: "2026-11-16T00:00:00+03:00",
    }),
  );
  expect(await created.json()).toEqual({
    ok: false,
    code: "revision_conflict",
  });
  await handleRevokePaymentLink(
    command("/api/authoring/billing/payment-links/revoke", {
      operationId,
      id: linkId,
      expectedRevision: 2,
    }),
  );
  expect(fakes.manage.mock.calls.map(([body]) => body)).toEqual([
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

it("lists owner promotions without questionnaire ones unless asked", async () => {
  fakes.manage.mockResolvedValue(
    ok({
      operationRef: operationId,
      result: { outcome: "promotions", items: [], nextCursor: null },
    }),
  );
  await handleListPromotions(
    command("/api/authoring/billing/promotions/list", {
      operationId,
      limit: 50,
      archived: true,
      productId,
    }),
  );
  expect(fakes.manage).toHaveBeenCalledWith(
    {
      operation: "promotions.list",
      operationId,
      limit: 50,
      archived: true,
      questionnaire: false,
      productId,
    },
    "owner-token",
    {},
  );
});

it("saves an edit with the list revision and archives with the expected revision", async () => {
  const catalog = ok({
    operationRef: operationId,
    result: {
      outcome: "catalog",
      value: { id: promotionId, revision: 5, archived: false },
    },
  });
  fakes.manage.mockResolvedValue(catalog);
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
  const saved = await handleSavePromotion(
    command("/api/authoring/billing/promotions/save", {
      operationId,
      expectedRevision: 4,
      value,
    }),
  );
  expect(await saved.json()).toMatchObject({ ok: true });
  await handleArchivePromotion(
    command("/api/authoring/billing/promotions/archive", {
      operationId,
      id: promotionId,
      expectedRevision: 5,
    }),
  );
  expect(fakes.manage.mock.calls.map(([body]) => body)).toEqual([
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
  fakes.manage.mockResolvedValue(problem("forbidden", 403));
  const response = await handleQuestionnaireRespondents(
    command("/api/authoring/billing/respondents/status", { operationId }),
  );
  expect(await response.json()).toEqual({ ok: false, code: "forbidden" });
});

it("reads every page of the owner price catalog and refuses for another role", async () => {
  fakes.manage
    .mockResolvedValueOnce(
      ok({
        operationRef: operationId,
        result: { outcome: "catalogOffers", items: [], nextCursor: cursor },
      }),
    )
    .mockResolvedValueOnce(
      ok({
        operationRef: operationId,
        result: { outcome: "catalogOffers", items: [], nextCursor: null },
      }),
    );
  const response = await handleOwnerPriceCatalogRead();
  expect(await response.json()).toEqual({ ok: true, value: [] });
  expect(fakes.manage.mock.calls.map(([body]) => body)).toEqual([
    expect.objectContaining({ operation: "productPrices.list", limit: 100 }),
    expect.objectContaining({ operation: "productPrices.list", cursor }),
  ]);

  fakes.manage.mockReset();
  fakes.manage.mockResolvedValue(problem("forbidden", 403));
  const refused = await handleOwnerPriceCatalogRead();
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ ok: false, code: "forbidden" });
});
