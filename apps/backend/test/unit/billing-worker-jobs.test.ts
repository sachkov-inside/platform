import { expect, test } from "vitest";
import {
  runNoticeJob,
  runRecoveryJob,
  runRenewalJob,
} from "../../src/entrypoints/billing-worker/jobs.js";
import { paymentFailure } from "../../src/modules/billing/features/purchase-subscription/purchase-subscription.contract.js";

// Mapping tests for the process adapter: application acceptance uses real facades and PostgreSQL.
test("renewal job rejects a failed payment pass", async () => {
  await expect(
    runRenewalJob(
      {
        renew: () => Promise.resolve(paymentFailure("dependency_unavailable")),
      },
      {
        reconcileMethodFlows: () => {
          throw new Error("bindings must not run after a failed renewal");
        },
      },
    ),
  ).rejects.toThrow("dependency_unavailable");
});

test("renewal job rejects a failed binding pass instead of hiding its error in a report", async () => {
  await expect(
    runRenewalJob(
      {
        renew: () =>
          Promise.resolve({
            ok: true,
            value: {
              status: "ready",
              terminal: "ready",
              inspected: 0,
              started: 0,
              blocked: 0,
              closed: 0,
            },
          }),
      },
      {
        reconcileMethodFlows: () =>
          Promise.resolve(paymentFailure("dependency_unavailable")),
      },
    ),
  ).rejects.toThrow("dependency_unavailable");
});

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
            value: { status: "ready", inspected: 0, applied: 0 },
          }),
      },
      {
        reconcileRefunds: () =>
          Promise.reject(new Error("synthetic refund database failure")),
      },
    ),
  ).rejects.toThrow("synthetic refund database failure");
});

test("notice job rejects a failed calendar pass", async () => {
  await expect(
    runNoticeJob({
      scheduleReminders: () =>
        Promise.resolve(paymentFailure("dependency_unavailable")),
    }),
  ).rejects.toThrow("dependency_unavailable");
});
