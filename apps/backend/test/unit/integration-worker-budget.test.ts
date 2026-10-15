import { expect, test } from "vitest";

import integrationConfig from "../../vitest.integration.config.mjs";
import { integrationWorkerBudget } from "../integration/setup/worker-budget.js";

test("the integration command bounds its file workers", () => {
  expect(integrationConfig.test?.maxWorkers).toBeTypeOf("number");
});

test.each([
  { availableCpuCount: 4, availableMemoryBytes: 16 * 1024 ** 3, workers: 2 },
  { availableCpuCount: 12, availableMemoryBytes: 8 * 1024 ** 3, workers: 4 },
  { availableCpuCount: 12, availableMemoryBytes: 3 * 1024 ** 3, workers: 1 },
  { availableCpuCount: 7, availableMemoryBytes: 16 * 1024 ** 3, workers: 3 },
  { availableCpuCount: 1, availableMemoryBytes: 16 * 1024 ** 3, workers: 1 },
  { availableCpuCount: 12, availableMemoryBytes: 0, workers: 1 },
])(
  "budgets $workers workers for $availableCpuCount CPUs and $availableMemoryBytes available bytes",
  (resources) => {
    expect(integrationWorkerBudget(resources)).toBe(resources.workers);
  },
);

// Dedicated hosted runners do not share their CPU budget with another local session.
test.each([
  { availableCpuCount: 4, availableMemoryBytes: 7 * 1024 ** 3, workers: 3 },
  { availableCpuCount: 16, availableMemoryBytes: 16 * 1024 ** 3, workers: 3 },
  { availableCpuCount: 4, availableMemoryBytes: 4 * 1024 ** 3, workers: 2 },
  { availableCpuCount: 4, availableMemoryBytes: 2 * 1024 ** 3, workers: 1 },
  { availableCpuCount: 2, availableMemoryBytes: 7 * 1024 ** 3, workers: 1 },
  { availableCpuCount: 1, availableMemoryBytes: 0, workers: 1 },
])(
  "reserves hosted-runner resources with $workers workers for $availableCpuCount CPUs and $availableMemoryBytes bytes",
  (resources) => {
    expect(
      integrationWorkerBudget({ ...resources, isolatedRunner: true }),
    ).toBe(resources.workers);
  },
);
