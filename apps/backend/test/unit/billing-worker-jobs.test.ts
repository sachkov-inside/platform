import { expect, test } from "vitest";
import {
  recoveryBudgetMilliseconds,
  runRecoveryJob,
} from "../../src/entrypoints/billing-worker/jobs.js";
import { recoveryItemMilliseconds } from "../../src/modules/billing/index.js";
import { paymentFailure } from "../../src/modules/billing/features/purchase-product/purchase-product.contract.js";

const passed = {
  ok: true,
  value: {
    status: "ready",
    inspected: 0,
    deferred: 0,
    applied: 0,
    failed: 0,
  },
} as const;
const settled = {
  status: "ready",
  inspected: 0,
  deferred: 0,
  settled: 0,
  failed: 0,
} as const;

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
      new AbortController().signal,
    ),
  ).rejects.toThrow("dependency_unavailable");
});

test("recovery job rejects a failed refund pass", async () => {
  await expect(
    runRecoveryJob(
      { recover: () => Promise.resolve(passed) },
      {
        reconcileRefunds: () =>
          Promise.reject(new Error("synthetic refund database failure")),
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("synthetic refund database failure");
});

test("recovery job hands one budget to the payment and refund passes", async () => {
  const budget = new AbortController().signal;
  const received: (AbortSignal | undefined)[] = [];
  await runRecoveryJob(
    {
      recover: (_limit, signal) => {
        received.push(signal);
        return Promise.resolve(passed);
      },
    },
    {
      reconcileRefunds: (_limit, signal) => {
        received.push(signal);
        return Promise.resolve(settled);
      },
    },
    budget,
  );
  expect(received).toEqual([budget, budget]);
});

test("the recovery budget leaves the job deadline room for a row started at its last moment", () => {
  const deadline = 300_000;
  const budget = recoveryBudgetMilliseconds(deadline);
  expect(budget).toBeGreaterThan(0);
  expect(budget + recoveryItemMilliseconds).toBeLessThan(deadline);
});
