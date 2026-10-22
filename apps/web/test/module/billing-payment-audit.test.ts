import { readPaymentInputSchema } from "@/features/billing-admin/model/admin-operations";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { materialsOffer } from "@/storybook/billing.fixtures";
type BoundaryAnswer =
  | { readonly body: unknown; readonly ok: true }
  | { readonly ok: false; readonly status: number };
/** Ответ маршрута на каждую команду браузерного адаптера; вход приходит разобранным JSON. */
const boundary = {
  request:
    vi.fn<
      (url: string, method: string, input: unknown) => Promise<BoundaryAnswer>
    >(),
};
import { readBillingPayment } from "@/features/billing-admin/api/billing-admin.browser";
const purchaseRef = "00000603-0000-4000-8000-000000000101";
const operationId = "00000600-0000-4000-8000-000000000001";
const now = "2026-10-01T00:00:00.000Z";
const cursor = { purchaseRef, afterSequence: "100" };
const command = (n: number) => ({
  actorId: operationId,
  operationId: `00000604-0000-4000-8000-${String(n).padStart(12, "0")}`,
  operation: "payments.reconcile",
  reason: String(n),
  createdAt: now,
});
const value = {
  purchaseRef,
  accountId: operationId,
  state: "failed",
  kind: "initial",
  subscriptionRef: null,
  periodIndex: null,
  amountKopecks: 1000,
  environment: "demo",
  terminalRef: "SYNTHETICHISTORY",
  paymentId: null,
  snapshot: materialsOffer,
  fiscalization: "pending",
  confirmedAt: null,
  periodEndsAt: null,
  createdAt: now,
  updatedAt: now,
  access: "awaiting_payment",
  refundedKopecks: 0,
  refundableKopecks: 0,
};
function page(audit: unknown[], nextAuditCursor: unknown) {
  return {
    ok: true as const,
    body: {
      ok: true,
      value: {
        operationRef: operationId,
        result: {
          outcome: "payment",
          value,
          events: [],
          decisions: [],
          audit,
          nextAuditCursor,
        },
      },
    },
  };
}
beforeEach(() => {
  boundary.request.mockReset();
  vi.stubGlobal(
    "fetch",
    async (url: string, init: RequestInit): Promise<Response> => {
      const answer = await boundary.request(
        url,
        init.method ?? "GET",
        JSON.parse(z.string().parse(init.body)),
      );
      return answer.ok
        ? Response.json(answer.body)
        : new Response(null, { status: answer.status });
    },
  );
});
it("loads all 101 audit rows with fresh continuation operation identity", async () => {
  boundary.request
    .mockResolvedValueOnce(
      page(
        Array.from({ length: 100 }, (_, index) => command(index + 1)),
        cursor,
      ),
    )
    .mockResolvedValueOnce(page([command(101)], null));
  const result = await readBillingPayment({ purchaseRef, operationId });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(result.value.result.audit.map((entry) => entry.reason)).toEqual(
    Array.from({ length: 101 }, (_, index) => String(index + 1)),
  );
  expect(result.value.result.nextAuditCursor).toBeNull();
  expect(boundary.request).toHaveBeenCalledTimes(2);
  const input = readPaymentInputSchema.parse(
    boundary.request.mock.calls[1]?.[2],
  );
  expect(input.auditCursor).toEqual(cursor);
  expect(input.operationId).not.toBe(operationId);
});
it("reports failed continuation and allows a subsequent complete retry", async () => {
  boundary.request
    .mockResolvedValueOnce(page([command(1)], cursor))
    .mockResolvedValueOnce({ ok: false, status: 503 });
  expect(await readBillingPayment({ purchaseRef, operationId })).toEqual({
    ok: false,
    code: "unavailable",
  });
  boundary.request
    .mockResolvedValueOnce(page([command(1)], cursor))
    .mockResolvedValueOnce(page([command(2)], null));
  const retry = await readBillingPayment({ purchaseRef, operationId });
  expect(retry.ok).toBe(true);
  if (retry.ok) expect(retry.value.result.audit).toHaveLength(2);
});
it("refuses missing continuation contract and cycles instead of claiming exhaustion", async () => {
  const malformed = page([command(1)], null);
  delete (malformed.body.value.result as { nextAuditCursor?: unknown })
    .nextAuditCursor;
  boundary.request.mockResolvedValueOnce(malformed);
  expect(await readBillingPayment({ purchaseRef, operationId })).toEqual({
    ok: false,
    code: "unavailable",
  });
  boundary.request.mockResolvedValue(page([command(1)], cursor));
  expect(await readBillingPayment({ purchaseRef, operationId })).toEqual({
    ok: false,
    code: "unavailable",
  });
  expect(boundary.request).toHaveBeenCalledTimes(3);
});
