import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { realBffSession } from "../support/real-bff-session";
import { ownerBillingBackend } from "../support/owner-billing-backend";
let backend: ReturnType<typeof ownerBillingBackend>;
let session: Awaited<ReturnType<typeof realBffSession>>;

import { handleOrderEmailRequest } from "@/_pages/sales-payment.server";
import {
  handleReconcilePayment,
  handleOwnerPaymentProductsRequest,
  handleOwnerPaymentRequest,
  handleOwnerPaymentsRequest,
} from "@/features/owner-payments.server";
import { ownerPayment } from "../fixtures/owner-payments.fixtures";

const origin = "https://inside.example.test";
const operationRef = "77000000-0000-4000-8000-000000000001";
const productId = "77000000-0000-4000-8000-0000000000f1";
const purchaseRef = "77000000-0000-4000-8000-0000000000b1";
const email = "buyer.order@example.test";

const ok = (body: unknown) => Response.json(body);
const problem = (code: string, status: number) =>
  Response.json({ code }, { status });
/** Чтение не пишет receipt: ссылка операции у каждого вызова своя. */
const anyOperationId: unknown = expect.any(String);
const get = (path: string) => new Request(`${origin}${path}`);

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("vary")).toContain("cookie");
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession("owner-token");
  backend = ownerBillingBackend();
});

afterEach(() => vi.useRealTimers());

describe("payments list BFF", () => {
  it("sends state, product and the instant range to payments.list", async () => {
    const payment = ownerPayment(0);
    backend.command.mockImplementation(() =>
      Promise.resolve(
        ok({
          operationRef,
          result: { outcome: "payments", items: [payment], nextCursor: null },
        }),
      ),
    );

    const response = await session(() =>
      handleOwnerPaymentsRequest(
        get(
          `/api/authoring/billing/owner-payments?limit=50&state=unknown&state=failed&productId=${productId}&from=2026-09-30T21%3A00%3A00.000Z&to=2026-10-20T21%3A00%3A00.000Z`,
        ),
      ),
    );

    expect(await commandBody(backend.command.mock.calls.at(-1)?.[0])).toEqual({
      operation: "payments.list",
      operationId: anyOperationId,
      limit: 50,
      states: ["unknown", "failed"],
      productId,
      from: "2026-09-30T21:00:00.000Z",
      to: "2026-10-20T21:00:00.000Z",
    });
    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: { items: [payment], nextCursor: null },
    });
  });

  it("refuses a filter outside the schema without calling billing", async () => {
    const response = await session(() =>
      handleOwnerPaymentsRequest(
        get("/api/authoring/billing/owner-payments?state=paid"),
      ),
    );

    expect(backend.command).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "invalid_request",
    });
  });

  it("keeps another role's refusal a refusal, not an empty list", async () => {
    backend.command.mockImplementation(() =>
      Promise.resolve(problem("forbidden", 403)),
    );

    const response = await session(() =>
      handleOwnerPaymentsRequest(get("/api/authoring/billing/owner-payments")),
    );

    expect(response.status).toBe(403);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "forbidden",
    });
  });

  it("asks for a sign-in without a session", async () => {
    session = await realBffSession(null);

    const response = await session(() =>
      handleOwnerPaymentsRequest(get("/api/authoring/billing/owner-payments")),
    );

    expect(response.status).toBe(401);
    expect(backend.command).not.toHaveBeenCalled();
  });
});

describe("product choices BFF", () => {
  it("offers products by name, without materials, sorted for Russian", async () => {
    backend.command.mockImplementation(() =>
      Promise.resolve(
        ok({
          operationRef,
          result: {
            outcome: "content",
            items: [
              {
                kind: "product",
                id: productId,
                title: "Разработка с агентами",
                slug: null,
                available: true,
              },
              {
                kind: "material",
                id: purchaseRef,
                title: "Ревью кода",
                slug: null,
                available: true,
              },
              {
                kind: "product",
                id: operationRef,
                title: "Архитектура",
                slug: "architecture",
                available: false,
              },
            ],
          },
        }),
      ),
    );

    const response = await session(() => handleOwnerPaymentProductsRequest());

    expect(await commandBody(backend.command.mock.calls.at(-1)?.[0])).toEqual({
      operation: "content.list",
      operationId: anyOperationId,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: [
        { id: operationRef, name: "Архитектура" },
        { id: productId, name: "Разработка с агентами" },
      ],
    });
  });
});

describe("payment read BFF", () => {
  const page = {
    operationRef,
    result: {
      outcome: "payment",
      value: ownerPayment(0, { purchaseRef }),
      events: [],
      decisions: [],
      audit: [],
      nextAuditCursor: { purchaseRef, afterSequence: "100" },
    },
  };

  it("continues the audit of the same payment only", async () => {
    backend.command.mockImplementation(() => Promise.resolve(ok(page)));

    const response = await session(() =>
      handleOwnerPaymentRequest(
        get(
          `/api/authoring/billing/owner-payments/${purchaseRef}?auditAfter=100`,
        ),
        purchaseRef.toUpperCase(),
      ),
    );

    expect(await commandBody(backend.command.mock.calls.at(-1)?.[0])).toEqual({
      operation: "payments.read",
      operationId: anyOperationId,
      purchaseRef,
      auditCursor: { purchaseRef, afterSequence: "100" },
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      value: { nextAuditAfter: "100" },
    });
  });

  it("refuses a malformed address or audit position without calling billing", async () => {
    for (const [ref, after] of [
      ["not-a-ref", null],
      [purchaseRef, "0"],
    ] as const) {
      const response = await session(() =>
        handleOwnerPaymentRequest(
          get(
            `/api/authoring/billing/owner-payments/${ref}${after === null ? "" : `?auditAfter=${after}`}`,
          ),
          ref,
        ),
      );
      expect(response.status).toBe(400);
    }
    expect(backend.command).not.toHaveBeenCalled();
  });

  it("keeps a missing payment a missing payment", async () => {
    backend.command.mockImplementation(() =>
      Promise.resolve(problem("not_found", 404)),
    );

    const response = await session(() =>
      handleOwnerPaymentRequest(
        get(`/api/authoring/billing/owner-payments/${purchaseRef}`),
        purchaseRef,
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "not_found",
    });
  });
});

describe("order email BFF", () => {
  it("answers the order email privately and never through the list command", async () => {
    backend.orderEmail.mockResolvedValue(ok({ email }));

    const response = await session(() =>
      handleOrderEmailRequest(purchaseRef.toUpperCase()),
    );

    expect(backend.orderEmail).toHaveBeenCalledOnce();
    const sent = backend.orderEmail.mock.calls[0]?.[0];
    expect(sent?.url).toBe(
      `https://platform-api.example.test/billing/admin/payments/${purchaseRef}/order-email`,
    );
    expect(sent?.method).toBe("GET");
    expect(sent?.headers.get("authorization")).toBe("Bearer owner-token");
    expect(sent?.body).toBeNull();
    expect(backend.command).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: { email },
    });
  });

  it("says when the order has no email", async () => {
    backend.orderEmail.mockResolvedValue(ok({ email: null }));

    const response = await session(() => handleOrderEmailRequest(purchaseRef));

    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: { email: null },
    });
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
  ])("keeps a %i refusal as %s", async (status, code) => {
    backend.orderEmail.mockResolvedValue(problem(code, status));

    const response = await session(() => handleOrderEmailRequest(purchaseRef));

    expect(response.status).toBe(status);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: false, code });
  });

  it("reports an unavailable dependency as such, with no address in the answer", async () => {
    backend.orderEmail.mockResolvedValue(
      problem("dependency_unavailable", 503),
    );

    const response = await session(() => handleOrderEmailRequest(purchaseRef));

    expect(response.status).toBe(503);
    expectPrivate(response);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ kind: "dependency_unavailable" });
    expect(body).not.toContain("@");
  });

  it("refuses a malformed address without asking billing", async () => {
    const response = await session(() =>
      handleOrderEmailRequest("../payments"),
    );

    expect(response.status).toBe(404);
    expect(backend.orderEmail).not.toHaveBeenCalled();
  });

  it("does not accept a body outside the contract as an email", async () => {
    backend.orderEmail.mockResolvedValue(ok({ email: "not an email" }));

    const response = await session(() => handleOrderEmailRequest(purchaseRef));

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("not an email");
  });
});

describe("reconcile BFF", () => {
  const operationId = "77000000-0000-4000-8000-0000000000e1";
  const post = (body: unknown) =>
    new Request(`${origin}/api/authoring/billing/owner-payments/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });

  it("asks billing to reconcile with the bank budget and returns the payment", async () => {
    const deadline = vi.spyOn(AbortSignal, "timeout");
    const payment = ownerPayment(3, { purchaseRef, state: "confirmed" });
    backend.command.mockImplementation(() =>
      Promise.resolve(
        ok({ operationRef, result: { outcome: "reconciled", value: payment } }),
      ),
    );

    const response = await session(() =>
      handleReconcilePayment(post({ operationId, purchaseRef })),
    );

    expect(await commandBody(backend.command.mock.calls.at(-1)?.[0])).toEqual({
      operation: "payments.reconcile",
      operationId,
      purchaseRef,
    });
    expect(deadline).toHaveBeenCalledWith(30_000);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: {
        operationRef,
        result: { outcome: "reconciled", value: payment },
      },
    });
  });

  it("keeps the bank's refusal as a closed code", async () => {
    backend.command.mockImplementation(() =>
      Promise.resolve(problem("provider_unavailable", 503)),
    );

    const response = await session(() =>
      handleReconcilePayment(post({ operationId, purchaseRef })),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "provider_unavailable",
    });
  });
});

async function commandBody(request: Request | undefined): Promise<unknown> {
  if (request === undefined)
    throw new Error("Expected owner Billing HTTP request");
  expect(request.headers.get("authorization")).toBe("Bearer owner-token");
  return request.clone().json();
}
