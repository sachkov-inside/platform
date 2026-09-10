import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  offers: vi.fn(),
  quote: vi.fn(),
  consents: vi.fn(),
  purchase: vi.fn(),
  status: vi.fn(),
  current: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestBillingOffers: fakes.offers,
  requestBillingQuote: fakes.quote,
  requestBillingConsents: fakes.consents,
  requestBillingPurchase: fakes.purchase,
  requestBillingPurchaseStatus: fakes.status,
  requestCurrentBilling: fakes.current,
  requestCancelBillingRenewal: fakes.cancel,
  requestResumeBillingRenewal: vi.fn(),
  requestBillingChangeQuote: vi.fn(),
  requestBillingChange: vi.fn(),
  requestCancelBillingChange: vi.fn(),
  requestChangeBillingMethod: vi.fn(),
  requestRevokeBillingMethod: vi.fn(),
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

import {
  handleBillingOffers,
  handleBillingPurchase,
  handleBillingPurchaseStatus,
  handleBillingQuote,
} from "@/features/billing-checkout.server";
import { handleBillingConsents } from "@/entities/subscription.server";
import { handleCancelRenewal, handleCurrentBilling } from "@/features/billing-subscription.server";
import {
  activeSubscription,
  savedQuote,
  supportOffer,
  pendingPurchase,
} from "@/workshop/billing.fixtures";

const origin = "https://inside.example.test";
const operationId = "20000000-0000-4000-8000-000000000001";
const evidence = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
];

function command(url: string, input: unknown, requestOrigin = origin): Request {
  const body = new FormData();
  body.set("input", JSON.stringify(input));
  return new Request(`${origin}${url}`, {
    method: "POST",
    headers: { origin: requestOrigin },
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
  fakes.token.mockResolvedValue("trusted-token");
});

it("отдаёт витрину с сервера без сессии покупателя", async () => {
  fakes.offers.mockResolvedValue(ok({ items: [supportOffer], nextCursor: null }));
  const response = await handleBillingOffers();
  expect(await response.json()).toEqual({
    ok: true,
    value: { items: [supportOffer], nextCursor: null },
  });
  expect(fakes.offers).toHaveBeenCalledWith({ limit: 50 });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("сохраняет расчёт под собственным operationId и не передаёт пустой промокод", async () => {
  fakes.quote.mockResolvedValue(ok(savedQuote));
  const response = await handleBillingQuote(
    command("/api/account/billing/quote", {
      operationId,
      paymentOptionId: supportOffer.paymentOption.id,
      optionRevision: supportOffer.paymentOption.revision,
    }),
  );
  expect(await response.json()).toEqual({ ok: true, value: savedQuote });
  expect(fakes.quote).toHaveBeenCalledWith(
    {
      operationId,
      paymentOptionId: supportOffer.paymentOption.id,
      optionRevision: supportOffer.paymentOption.revision,
    },
    "trusted-token",
  );
});

it("отмечает каждый принятый документ и передаёт контекст расчёта", async () => {
  fakes.consents.mockResolvedValue(ok({ ok: true, evidenceRefs: evidence }));
  await handleBillingConsents(
    command("/api/account/billing/consents", {
      operationId,
      contextRef: savedQuote.quoteRef,
      documents: [
        {
          kind: "terms",
          documentId: "offer",
          version: "2026-09-01",
          digest: "a".repeat(64),
        },
      ],
    }),
  );
  expect(fakes.consents).toHaveBeenCalledWith(
    {
      operationId,
      contextRef: savedQuote.quoteRef,
      documents: [
        {
          kind: "terms",
          documentId: "offer",
          version: "2026-09-01",
          digest: "a".repeat(64),
          accepted: true,
        },
      ],
    },
    "trusted-token",
  );
});

it("переносит ожидаемый исход покупки без потери смысла", async () => {
  fakes.purchase.mockResolvedValue(problem("existing_access", 409));
  const response = await handleBillingPurchase(
    command("/api/account/billing/purchase", {
      operationId,
      quoteRef: savedQuote.quoteRef,
      contactRevision: 2,
      consentEvidenceRefs: evidence,
      acknowledgeExistingAccess: false,
    }),
  );
  expect(await response.json()).toEqual({ ok: false, code: "existing_access" });
});

it("отклоняет неполную команду покупки до обращения к бэкенду", async () => {
  const response = await handleBillingPurchase(
    command("/api/account/billing/purchase", {
      operationId,
      quoteRef: savedQuote.quoteRef,
      contactRevision: 2,
      consentEvidenceRefs: [evidence[0]],
      acknowledgeExistingAccess: false,
    }),
  );
  expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
  expect(fakes.purchase).not.toHaveBeenCalled();
});

it("не выполняет команду с чужого источника", async () => {
  const response = await handleBillingPurchase(
    command(
      "/api/account/billing/purchase",
      { operationId },
      "https://attacker.example.test",
    ),
  );
  expect(response.status).toBe(403);
  expect(fakes.purchase).not.toHaveBeenCalled();
});

it("читает состояние покупки только по собственной ссылке", async () => {
  fakes.status.mockResolvedValue(ok(pendingPurchase));
  const found = await handleBillingPurchaseStatus(
    new Request(
      `${origin}/api/account/billing/purchase-status?purchaseRef=${pendingPurchase.purchaseRef}`,
    ),
  );
  expect(await found.json()).toEqual({ ok: true, value: pendingPurchase });
  expect(fakes.status).toHaveBeenCalledWith(
    pendingPurchase.purchaseRef,
    "trusted-token",
  );

  const missing = await handleBillingPurchaseStatus(
    new Request(`${origin}/api/account/billing/purchase-status`),
  );
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ ok: false, code: "not_found" });
});

it("отвечает 401 на собственный read без действующей сессии", async () => {
  const { LogtoSessionUnavailableError } = await import(
    "@/shared/auth/platform-access-token.server"
  );
  fakes.token.mockRejectedValue(new LogtoSessionUnavailableError());
  const response = await handleCurrentBilling();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ ok: false, code: "unauthorized" });
  expect(fakes.current).not.toHaveBeenCalled();
});

it("возвращает подписку и её поводы одним конвертом", async () => {
  fakes.current.mockResolvedValue(
    ok({ subscription: activeSubscription, notices: [] }),
  );
  const response = await handleCurrentBilling();
  expect(await response.json()).toEqual({
    ok: true,
    value: { subscription: activeSubscription, notices: [] },
  });
});

it("требует ожидаемую редакцию для отмены продления", async () => {
  fakes.cancel.mockResolvedValue(problem("revision_conflict", 409));
  const response = await handleCancelRenewal(
    command("/api/account/billing/subscription/cancel", {
      operationId,
      expectedRevision: 7,
    }),
  );
  expect(await response.json()).toEqual({
    ok: false,
    code: "revision_conflict",
  });
  expect(fakes.cancel).toHaveBeenCalledWith(
    { operationId, expectedRevision: 7 },
    "trusted-token",
  );
});
