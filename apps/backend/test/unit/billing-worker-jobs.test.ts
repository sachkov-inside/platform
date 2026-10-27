import { expect, test } from "vitest";
import { runRecoveryJob } from "../../src/entrypoints/billing-worker/jobs.js";
import { paymentFailure } from "../../src/modules/billing/features/purchase-product/purchase-product.contract.js";
test("recovery job rejects a failed payment pass", async () => {
  await expect(
    runRecoveryJob(
      {
        recover: () =>
          Promise.resolve(paymentFailure("dependency_unavailable")),
      },
      {
        reconcileRefunds: () => {
          throw new Error("refunds must not run after failed recovery");
        },
      },
    ),
  ).rejects.toThrow("dependency_unavailable");
});

test("recovery job rejects a failed refund pass", async () => {
  await expect(
    runRecoveryJob(
      {
        recover: () =>
          Promise.resolve({
            ok: true,
            value: { status: "ready", inspected: 0, applied: 0, failed: 0 },
          }),
      },
      {
        reconcileRefunds: () =>
          Promise.reject(new Error("synthetic refund database failure")),
      },
    ),
  ).rejects.toThrow("synthetic refund database failure");
});
