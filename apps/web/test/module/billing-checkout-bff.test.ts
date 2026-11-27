import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
import { interceptBackendHttp } from "../support/backend-http";
import {
  interceptIdentityOutage,
  expectIdentityOutage,
} from "../support/identity-http";

import {
  handleBillingPurchase as realBillingPurchase,
  handleBillingPurchaseStatus as realBillingPurchaseStatus,
  handleBillingQuote as realBillingQuote,
} from "@/features/billing-checkout.server";
import {
  loadBillingOffers,
  loadViewerBillingOffers,
} from "@/entities/subscription.server";
import { handleBillingConsents as realBillingConsents } from "@/entities/subscription.server";
import { handleCurrentBilling as realCurrentBilling } from "@/features/billing-subscription.server";
import {
  accessGrounds,
  materialsOffer,
  ownPayments,
  pendingPurchase,
  savedQuote,
  supportOffer,
} from "../fixtures/billing.fixtures";

const origin = "https://inside.example.test";
const operationId = "20000000-0000-4000-8000-000000000001";
const evidence = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
];

function command(url: string, input: unknown, requestOrigin = origin): Request {
  return new Request(`${origin}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: requestOrigin },
    body: JSON.stringify(input),
  });
}
interface BackendReply {
  method: string;
  path: string;
  body: unknown;
  status: number;
}
let scope: Awaited<ReturnType<typeof realBffSession>>;
let replies: BackendReply[];
const backend = vi.fn<(request: Request) => Promise<Response>>();
function reply(
  method: string,
  path: string,
  body: unknown,
  status = 200,
): void {
  replies.push({ method, path, body, status });
}
function outgoing(index = 0): Request {
  const request = backend.mock.calls[index]?.[0];
  if (request === undefined)
    throw new Error("Expected external backend request");
  return request;
}
const handleBillingQuote = (request: Request) =>
  scope(() => realBillingQuote(request));
const handleBillingPurchase = (request: Request) =>
  scope(() => realBillingPurchase(request));
const handleBillingPurchaseStatus = (request: Request) =>
  scope(() => realBillingPurchaseStatus(request));
const handleBillingConsents = (request: Request) =>
  scope(() => realBillingConsents(request));
const handleCurrentBilling = () => scope(() => realCurrentBilling());
let expectedToken: string | null;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  scope = await realBffSession();
  replies = [];
  expectedToken = "trusted-token";
  backend.mockReset();
  backend.mockImplementation(() => {
    const next = replies[backend.mock.calls.length - 1];
    if (next === undefined) throw new Error("Unexpected backend request");
    return Promise.resolve(Response.json(next.body, { status: next.status }));
  });
  interceptBackendHttp(backend);
});
afterEach(() => {
  try {
    expect(backend).toHaveBeenCalledTimes(replies.length);
    replies.forEach((expected, index) => {
      const request = outgoing(index);
      expect(request.method).toBe(expected.method);
      expect(request.url).toBe(
        `https://platform-api.example.test${expected.path}`,
      );
      expect(request.headers.get("authorization")).toBe(
        expectedToken === null ? null : `Bearer ${expectedToken}`,
      );
      if (expected.method === "GET") expect(request.body).toBeNull();
    });
  } finally {
    vi.useRealTimers();
  }
});

it("дочитывает каталог по курсору и не обрывает его молча", async () => {
  const cursor = "50000000-0000-4000-8000-000000000001";
  expectedToken = null;
  reply("GET", "/billing/product-prices?limit=50", {
    items: [materialsOffer],
    nextCursor: cursor,
  });
  reply("GET", `/billing/product-prices?limit=50&cursor=${cursor}`, {
    items: [supportOffer],
    nextCursor: null,
  });
  expect(await loadBillingOffers()).toEqual({
    kind: "ready",
    offers: [materialsOffer, supportOffer],
  });
});

it("читает каталог от имени вошедшего покупателя: Offer с ограничением допуска решает сервер", async () => {
  scope = await realBffSession("reader-token");
  expectedToken = "reader-token";
  reply("GET", "/billing/product-prices?limit=50", {
    items: [materialsOffer],
    nextCursor: null,
  });
  expect(await scope(() => loadViewerBillingOffers())).toEqual({
    kind: "ready",
    offers: [materialsOffer],
  });
});

it("сбой чтения сессии не выдаётся за гостевую витрину", async () => {
  scope = await realBffSession({ refreshToken: "expired-checkout-refresh" });
  const identity = interceptIdentityOutage();
  await expect(scope(() => loadViewerBillingOffers())).rejects.toThrow();
  expectIdentityOutage(identity);
  expect(backend).not.toHaveBeenCalled();
});

it("сообщает о недоступности каталога, а не показывает пустую витрину", async () => {
  expectedToken = null;
  reply(
    "GET",
    "/billing/product-prices?limit=50",
    { code: "dependency_unavailable" },
    503,
  );
  expect(await loadBillingOffers()).toEqual({ kind: "unavailable" });
});

it("сохраняет расчёт под собственным operationId и не передаёт пустой промокод", async () => {
  reply("POST", "/accounts/current/billing/quote", savedQuote);
  const response = await handleBillingQuote(
    command("/api/account/billing/quote", {
      operationId,
      productId: supportOffer.paymentOption.id,
      priceRevision: supportOffer.paymentOption.revision,
    }),
  );
  expect(await response.json()).toEqual({ ok: true, value: savedQuote });
  expect(await outgoing().json()).toEqual({
    operationId,
    productId: supportOffer.paymentOption.id,
    priceRevision: supportOffer.paymentOption.revision,
  });
});

it("передаёт принятые кнопкой документы, её подпись, экран и контекст расчёта", async () => {
  reply("POST", "/accounts/current/billing/consents", {
    ok: true,
    evidenceRefs: evidence,
  });
  await handleBillingConsents(
    command("/api/account/billing/consents", {
      operationId,
      contextRef: savedQuote.quoteRef,
      screen: "checkout",
      buttonLabel: "Оплатить 2 500 ₽",
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
  expect(await outgoing().json()).toEqual({
    operationId,
    contextRef: savedQuote.quoteRef,
    screen: "checkout",
    buttonLabel: "Оплатить 2 500 ₽",
    documents: [
      {
        kind: "terms",
        documentId: "offer",
        version: "2026-09-01",
        digest: "a".repeat(64),
        accepted: true,
      },
    ],
  });
});

it("передаёт браузеру смену редакции оферты, а не недоступность", async () => {
  // Сервер отказывает в согласии на редакцию, которая уже не действует.
  reply(
    "POST",
    "/accounts/current/billing/consents",
    { code: "document_changed" },
    409,
  );
  const response = await handleBillingConsents(
    command("/api/account/billing/consents", {
      operationId,
      contextRef: savedQuote.quoteRef,
      screen: "checkout",
      buttonLabel: "Оплатить 2 500 ₽",
      documents: [
        {
          kind: "terms",
          documentId: "purchase",
          version: "1",
          digest: "a".repeat(64),
        },
      ],
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: false,
    code: "document_changed",
  });
});

it("переносит ожидаемый исход покупки без потери смысла", async () => {
  reply(
    "POST",
    "/accounts/current/billing/purchase",
    { code: "existing_access" },
    409,
  );
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

it("передаёт нормализованный email заказа без подтверждённого контакта", async () => {
  reply("POST", "/accounts/current/billing/purchase", pendingPurchase);
  const input = {
    operationId,
    quoteRef: savedQuote.quoteRef,
    email: " Buyer@Example.test ",
    consentEvidenceRefs: [evidence[0]],
    acknowledgeExistingAccess: false,
  };
  expect(
    await (
      await handleBillingPurchase(
        command("/api/account/billing/purchase", input),
      )
    ).json(),
  ).toEqual({ ok: true, value: pendingPurchase });
  expect(await outgoing().json()).toEqual({
    ...input,
    email: "buyer@example.test",
  });
  expect(
    await (
      await handleBillingPurchase(
        command("/api/account/billing/purchase", { ...input, email: "broken" }),
      )
    ).json(),
  ).toEqual({ ok: false, code: "invalid_request" });
  expect(backend).toHaveBeenCalledOnce();
});

it("отклоняет неполную команду покупки до обращения к бэкенду", async () => {
  const response = await handleBillingPurchase(
    command("/api/account/billing/purchase", {
      operationId,
      quoteRef: savedQuote.quoteRef,
      contactRevision: 2,
      consentEvidenceRefs: [],
      acknowledgeExistingAccess: false,
    }),
  );
  expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
  expect(backend).not.toHaveBeenCalled();
});

it("пропускает разовую покупку с одним согласием: её оферта — единственный обязательный документ", async () => {
  // Прежняя нижняя граница в два свидетельства осталась от времён, когда продавалась только
  // подписка. Разовой покупке нужна одна оферта, и команда с ней доходит до приложения.
  reply("POST", "/accounts/current/billing/purchase", pendingPurchase);

  const response = await handleBillingPurchase(
    command("/api/account/billing/purchase", {
      operationId,
      quoteRef: savedQuote.quoteRef,
      contactRevision: 2,
      consentEvidenceRefs: [evidence[0]],
      acknowledgeExistingAccess: false,
    }),
  );

  expect(await response.json()).toEqual({ ok: true, value: pendingPurchase });
  expect(backend).toHaveBeenCalled();
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
  expect(backend).not.toHaveBeenCalled();
});

it("читает состояние покупки только по собственной ссылке", async () => {
  reply(
    "GET",
    `/accounts/current/billing/purchases/${pendingPurchase.purchaseRef}`,
    pendingPurchase,
  );
  const found = await handleBillingPurchaseStatus(
    new Request(
      `${origin}/api/account/billing/purchase-status?purchaseRef=${pendingPurchase.purchaseRef}`,
    ),
  );
  expect(await found.json()).toEqual({ ok: true, value: pendingPurchase });
  expect(backend).toHaveBeenCalledOnce();

  const missing = await handleBillingPurchaseStatus(
    new Request(`${origin}/api/account/billing/purchase-status`),
  );
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ ok: false, code: "not_found" });
});

it("отвечает 401 на собственный read без действующей сессии", async () => {
  scope = await realBffSession(null);
  const response = await handleCurrentBilling();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ kind: "authentication_required" });
  expect(backend).not.toHaveBeenCalled();
});

it("возвращает Product Access, основания, оплаты и поводы одним конвертом", async () => {
  const envelope = {
    products: [],
    notices: [],
    access: { grounds: accessGrounds },
    payments: ownPayments,
  };
  reply("GET", "/accounts/current/billing", envelope);
  const response = await handleCurrentBilling();
  expect(await response.json()).toEqual({ ok: true, value: envelope });
});

it("private quote forwards only the link authority, never an amount from the browser", async () => {
  const input = {
    operationId,
    productId: materialsOffer.product?.id,
    priceRevision: 1,
    paymentLinkId: "69000000-0000-4000-8000-000000001450",
  };
  reply("POST", "/accounts/current/billing/quote", savedQuote);
  await handleBillingQuote(command("/api/account/billing/quote", input));
  expect(await outgoing().json()).toEqual(input);
  const rejected = await handleBillingQuote(
    command("/api/account/billing/quote", { ...input, firstPriceKopecks: 100 }),
  );
  expect(await rejected.json()).toMatchObject({
    ok: false,
    code: "invalid_request",
  });
  expect(backend).toHaveBeenCalledOnce();
});
