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
  handleClassifyAccount,
  handleDecideRefund,
  handleExecuteRefund,
  handleListPayments,
  handlePreviewGrantBatch,
  handlePublishOffer,
  handleReadAccountClassification,
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
const accountId = "00000000-0000-4000-8000-0000000000c1";

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

it("читает и записывает решение о покупателе отдельными маршрутами", async () => {
  const classification = (value: string, revision: number, recurringAllowed: boolean) =>
    ok({
      operationRef: operationId,
      result: {
        outcome: "classification",
        value: { accountId, classification: value, revision, recurringAllowed },
      },
    });
  fakes.manage.mockResolvedValue(classification("unknown", 0, false));
  const read = await handleReadAccountClassification(
    command("/api/authoring/billing/grants/read-classification", {
      operationId,
      accountId,
    }),
  );
  expect(await read.json()).toMatchObject({
    ok: true,
    value: { result: { value: { classification: "unknown", recurringAllowed: false } } },
  });
  expect(fakes.manage).toHaveBeenCalledWith(
    { operation: "grants.readClassification", operationId, accountId },
    "owner-token",
    {},
  );

  fakes.manage.mockResolvedValue(classification("confirmed_new", 1, true));
  const decision = {
    operationId,
    accountId,
    expectedRevision: 0,
    classification: "confirmed_new",
    sourceRef: "enrolment-1",
    reason: "Заявка подтверждена",
    bridgeEnabled: false,
    tributeStopped: false,
  };
  const classified = await handleClassifyAccount(
    command("/api/authoring/billing/grants/classify", decision),
  );
  expect(await classified.json()).toMatchObject({ ok: true });
  expect(fakes.manage).toHaveBeenCalledWith(
    { ...decision, operation: "grants.classify" },
    "owner-token",
    {},
  );
});

it("отклоняет решение о покупателе с неизвестным состоянием", async () => {
  const response = await handleClassifyAccount(
    command("/api/authoring/billing/grants/classify", {
      operationId,
      accountId,
      expectedRevision: 0,
      classification: "confirmed_maybe",
      sourceRef: "enrolment-1",
      reason: "Заявка подтверждена",
      bridgeEnabled: false,
      tributeStopped: false,
    }),
  );
  expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
  expect(fakes.manage).not.toHaveBeenCalled();
});

it("отправляет выдачу и классификацию одним предпросмотром набора", async () => {
  fakes.manage.mockResolvedValue(
    ok({
      operationRef: operationId,
      result: {
        outcome: "grantPreview",
        previewRef,
        revision: 1,
        expiresAt: "2026-09-10T11:00:00.000Z",
        rows: [
          { rowKey: "grant", accountId, status: "confirmed" },
          { rowKey: "classify", accountId, status: "confirmed" },
        ],
      },
    }),
  );
  const rows = [
    {
      rowKey: "grant",
      accountId,
      source: "manual",
      sourceRef: "manual-1",
      terms: {
        capabilities: ["materials"],
        startsAt: "2026-09-01T09:00:00.000Z",
        validUntil: null,
        reason: "Ручная выдача",
      },
    },
    {
      rowKey: "classify",
      accountId,
      expectedRevision: 0,
      classification: "confirmed_new",
      sourceRef: "cohort-1",
      reason: "Перенос участника",
      bridgeEnabled: false,
      tributeStopped: false,
    },
  ];
  const response = await handlePreviewGrantBatch(
    command("/api/authoring/billing/grants/preview-batch", { operationId, rows }),
  );
  expect(await response.json()).toMatchObject({ ok: true });
  expect(fakes.manage).toHaveBeenCalledWith(
    { operation: "grants.previewBatch", operationId, rows },
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
