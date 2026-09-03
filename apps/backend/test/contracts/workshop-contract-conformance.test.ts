import { describe, expect, test } from "vitest";

import { runWorkshopContractCorpus } from "../../scripts/workshop-contract-conformance.js";

describe("Workshop wire contracts", () => {
  test("accepts and rejects the shared conformance corpus", async () => {
    await expect(runWorkshopContractCorpus()).resolves.toBeUndefined();
  });
});
