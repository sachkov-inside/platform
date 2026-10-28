import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn<() => Promise<string>>(),
  manage: vi.fn(),
  orderEmail: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestManageBilling: fakes.manage,
  requestOwnerOrderEmail: fakes.orderEmail,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: (): Promise<string> => fakes.token(),
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));

import { handleOrderEmailRequest } from "@/_pages/sales-payment.server";
import {
  handleReconcilePayment,
  handleOwnerPaymentProductsRequest,
  handleOwnerPaymentRequest,
  handleOwnerPaymentsRequest,
} from "@/features/owner-payments.server";
import { ownerPayment } from "@/storybook/owner-payments.fixtures";

const origin = "https://inside.example.test";
const operationRef = "77000000-0000-4000-8000-000000000001";
const productId = "77000000-0000-4000-8000-0000000000f1";
const purchaseRef = "77000000-0000-4000-8000-0000000000b1";
const email = "buyer.order@example.test";

const ok = (body: unknown) => ({ ok: true, body, response: new Response() });
const problem = (code: string, status: number) => ({
  ok: false,
  problem: { code },
  response: new Response(null, { status }),
});
/** Чтение не пишет receipt: ссылка операции у каждого вызова своя. */
const anyOperationId: unknown = expect.any(String);
const get = (path: string) => new Request(`${origin}${path}`);

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("vary")).toContain("cookie");
}

beforeEach(() => {
  vi.resetAllMocks();
  fakes.token.mockResolvedValue("owner-token");
});

describe("payments list BFF", () => {
  it("sends state, product and the instant range to payments.list", async () => {
    const payment = ownerPayment(0);
    fakes.manage.mockResolvedValue(
      ok({
        operationRef,
        result: { outcome: "payments", items: [payment], nextCursor: null },
      }),
    );

    const response = await handleOwnerPaymentsRequest(
      get(
        `/api/authoring/billing/owner-payments?limit=50&state=unknown&state=failed&productId=${productId}&from=2026-09-30T21%3A00%3A00.000Z&to=2026-10-20T21%3A00%3A00.000Z`,
      ),
    );

    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "payments.list",
        operationId: anyOperationId,
        limit: 50,
        states: ["unknown", "failed"],
        productId,
        from: "2026-09-30T21:00:00.000Z",
        to: "2026-10-20T21:00:00.000Z",
      },
      "owner-token",
    );
    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: { items: [payment], nextCursor: null },
    });
  });

  it("refuses a filter outside the schema without calling billing", async () => {
    const response = await handleOwnerPaymentsRequest(
      get("/api/authoring/billing/owner-payments?state=paid"),
    );

    expect(fakes.manage).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "invalid_request",
    });
  });

  it("keeps another role's refusal a refusal, not an empty list", async () => {
    fakes.manage.mockResolvedValue(problem("forbidden", 403));

    const response = await handleOwnerPaymentsRequest(
      get("/api/authoring/billing/owner-payments"),
    );

    expect(response.status).toBe(403);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "forbidden",
    });
  });

  it("asks for a sign-in without a session", async () => {
    const { LogtoSessionUnavailableError } =
      await import("@/shared/auth/session-adapter.server");
    fakes.token.mockRejectedValue(new LogtoSessionUnavailableError());

    const response = await handleOwnerPaymentsRequest(
      get("/api/authoring/billing/owner-payments"),
    );

    expect(response.status).toBe(401);
    expect(fakes.manage).not.toHaveBeenCalled();
  });
});

describe("product choices BFF", () => {
  it("offers products by name, without materials, sorted for Russian", async () => {
    fakes.manage.mockResolvedValue(
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
    );

    const response = await handleOwnerPaymentProductsRequest();

    expect(fakes.manage).toHaveBeenCalledWith(
      { operation: "content.list", operationId: anyOperationId },
      "owner-token",
    );
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
    fakes.manage.mockResolvedValue(ok(page));

    const response = await handleOwnerPaymentRequest(
      get(
        `/api/authoring/billing/owner-payments/${purchaseRef}?auditAfter=100`,
      ),
      purchaseRef.toUpperCase(),
    );

    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "payments.read",
        operationId: anyOperationId,
        purchaseRef,
        auditCursor: { purchaseRef, afterSequence: "100" },
      },
      "owner-token",
    );
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
      const response = await handleOwnerPaymentRequest(
        get(
          `/api/authoring/billing/owner-payments/${ref}${after === null ? "" : `?auditAfter=${after}`}`,
        ),
        ref,
      );
      expect(response.status).toBe(400);
    }
    expect(fakes.manage).not.toHaveBeenCalled();
  });

  it("keeps a missing payment a missing payment", async () => {
    fakes.manage.mockResolvedValue(problem("not_found", 404));

    const response = await handleOwnerPaymentRequest(
      get(`/api/authoring/billing/owner-payments/${purchaseRef}`),
      purchaseRef,
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
    fakes.orderEmail.mockResolvedValue(ok({ email }));

    const response = await handleOrderEmailRequest(purchaseRef.toUpperCase());

    expect(fakes.orderEmail).toHaveBeenCalledWith(purchaseRef, "owner-token");
    expect(fakes.manage).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: { email },
    });
  });

  it("says when the order has no email", async () => {
    fakes.orderEmail.mockResolvedValue(ok({ email: null }));

    const response = await handleOrderEmailRequest(purchaseRef);

    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: { email: null },
    });
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
  ])("keeps a %i refusal as %s", async (status, code) => {
    fakes.orderEmail.mockResolvedValue(problem(code, status));

    const response = await handleOrderEmailRequest(purchaseRef);

    expect(response.status).toBe(status);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: false, code });
  });

  it("reports an unavailable dependency as such, with no address in the answer", async () => {
    fakes.orderEmail.mockResolvedValue(problem("dependency_unavailable", 503));

    const response = await handleOrderEmailRequest(purchaseRef);

    expect(response.status).toBe(503);
    expectPrivate(response);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ kind: "dependency_unavailable" });
    expect(body).not.toContain("@");
  });

  it("refuses a malformed address without asking billing", async () => {
    const response = await handleOrderEmailRequest("../payments");

    expect(response.status).toBe(404);
    expect(fakes.orderEmail).not.toHaveBeenCalled();
  });

  it("does not accept a body outside the contract as an email", async () => {
    fakes.orderEmail.mockResolvedValue(ok({ email: "not an email" }));

    const response = await handleOrderEmailRequest(purchaseRef);

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
    const payment = ownerPayment(3, { purchaseRef, state: "confirmed" });
    fakes.manage.mockResolvedValue(
      ok({ operationRef, result: { outcome: "reconciled", value: payment } }),
    );

    const response = await handleReconcilePayment(
      post({ operationId, purchaseRef }),
    );

    expect(fakes.manage).toHaveBeenCalledWith(
      { operation: "payments.reconcile", operationId, purchaseRef },
      "owner-token",
      { bankCommand: true },
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: {
        operationRef,
        result: { outcome: "reconciled", value: payment },
      },
    });
  });

  it("keeps the bank's refusal as a closed code", async () => {
    fakes.manage.mockResolvedValue(problem("provider_unavailable", 503));

    const response = await handleReconcilePayment(
      post({ operationId, purchaseRef }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "provider_unavailable",
    });
  });
});
