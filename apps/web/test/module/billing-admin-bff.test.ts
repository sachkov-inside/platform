import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ token: vi.fn(), manage: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestManageBilling: fakes.manage,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

import {
  handleApplyGrantBatch,
  handleDecideRefund,
  handleExecuteRefund,
  handleListPayments,
  handlePublishOffer,
  handleSaveOffer,
  handleUnpublishOffer,
  loadBillingOffersForOwner,
} from "@/features/billing-admin.server";

const origin = "https://inside.example.test";
const operationId = "20000000-0000-4000-8000-000000000001";
const offerId = "00000000-0000-4000-8000-000000000101";
const purchaseRef = "00000000-0000-4000-8000-0000000000b1";
const decisionRef = "00000000-0000-4000-8000-0000000000d2";
const previewRef = "00000000-0000-4000-8000-0000000000d1";

function command(url: string, input: unknown): Request {
  const body = new FormData();
  body.set("input", JSON.stringify(input));
  return new Request(`${origin}${url}`, {
    method: "POST",
    headers: { origin },
    body,
  });
}
const ok = (body: unknown) => ({ ok: true, body, response: new Response() });
const problem = (code: string, status: number) => ({
  ok: false,
  problem: { code },
  response: new Response(null, { status }),
});

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("owner-token");
});

it("даёт каждой владельческой операции собственный маршрут и дискриминатор", async () => {
  fakes.manage.mockResolvedValue(
    ok({
      operationRef: operationId,
      result: {
        outcome: "catalog",
        value: { id: offerId, revision: 4, archived: false },
      },
    }),
  );
  const response = await handleSaveOffer(
    command("/api/authoring/billing/offers/save", {
      operationId,
      expectedRevision: 3,
      value: {
        id: offerId,
        name: "Материалы",
        benefits: ["materials", "community"],
      },
    }),
  );
  expect(await response.json()).toMatchObject({ ok: true });
  expect(fakes.manage).toHaveBeenCalledWith(
    {
      operation: "offers.save",
      operationId,
      expectedRevision: 3,
      value: {
        id: offerId,
        name: "Материалы",
        benefits: ["materials", "community"],
      },
    },
    "owner-token",
    {},
  );
});

it("не отправляет пустые необязательные фильтры платежей", async () => {
  fakes.manage.mockResolvedValue(
    ok({
      operationRef: operationId,
      result: { outcome: "payments", items: [], nextCursor: null },
    }),
  );
  await handleListPayments(
    command("/api/authoring/billing/payments/list", { operationId, limit: 25 }),
  );
  expect(fakes.manage).toHaveBeenCalledWith(
    { operation: "payments.list", operationId, limit: 25 },
    "owner-token",
    {},
  );
});

it("исполняет возврат с бюджетом банковской команды и не принимает новую сумму", async () => {
  fakes.manage.mockResolvedValue(problem("refund_in_progress", 409));
  const response = await handleExecuteRefund(
    command("/api/authoring/billing/refunds/execute", {
      operationId,
      decisionRef,
      expectedRevision: 1,
    }),
  );
  expect(await response.json()).toEqual({
    ok: false,
    code: "refund_in_progress",
  });
  expect(fakes.manage).toHaveBeenCalledWith(
    {
      operation: "refunds.execute",
      operationId,
      decisionRef,
      expectedRevision: 1,
    },
    "owner-token",
    { bankCommand: true },
  );
});

it("отклоняет решение о возврате без основания", async () => {
  const response = await handleDecideRefund(
    command("/api/authoring/billing/refunds/decide", {
      operationId,
      purchaseRef,
      amountKopecks: 100,
      access: "keep",
      recurring: "keep",
      reason: "   ",
    }),
  );
  expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
  expect(fakes.manage).not.toHaveBeenCalled();
});

it("применяет только подтверждённые строки того же предпросмотра", async () => {
  fakes.manage.mockResolvedValue(problem("preview_expired", 409));
  const response = await handleApplyGrantBatch(
    command("/api/authoring/billing/grants/apply-batch", {
      operationId,
      previewRef,
      expectedRevision: 1,
      confirmedRows: ["row-1"],
    }),
  );
  expect(await response.json()).toEqual({ ok: false, code: "preview_expired" });
  expect(fakes.manage).toHaveBeenCalledWith(
    {
      operation: "grants.applyBatch",
      operationId,
      previewRef,
      expectedRevision: 1,
      confirmedRows: ["row-1"],
    },
    "owner-token",
    {},
  );
});

it("включает и выключает продажу варианта отдельной обратимой командой", async () => {
  fakes.manage.mockResolvedValue(
    ok({
      operationRef: operationId,
      result: {
        outcome: "catalog",
        value: { id: offerId, revision: 3, archived: false, published: true },
      },
    }),
  );
  await handlePublishOffer(
    command("/api/authoring/billing/offers/publish", {
      operationId,
      id: offerId,
      expectedRevision: 2,
    }),
  );
  expect(fakes.manage).toHaveBeenCalledWith(
    { operation: "offers.publish", operationId, id: offerId, expectedRevision: 2 },
    "owner-token",
    {},
  );
  await handleUnpublishOffer(
    command("/api/authoring/billing/offers/unpublish", {
      operationId,
      id: offerId,
      expectedRevision: 3,
    }),
  );
  expect(fakes.manage).toHaveBeenCalledWith(
    { operation: "offers.unpublish", operationId, id: offerId, expectedRevision: 3 },
    "owner-token",
    {},
  );
});

it("читает владельческий каталог, где остаются и выключенные из продажи варианты", async () => {
  fakes.manage.mockResolvedValue(
    ok({
      operationRef: operationId,
      result: { outcome: "catalogOffers", items: [], nextCursor: null },
    }),
  );
  await expect(loadBillingOffersForOwner()).resolves.toEqual([]);
  expect(fakes.manage).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "offers.list", limit: 100 }),
    "owner-token",
  );
});
