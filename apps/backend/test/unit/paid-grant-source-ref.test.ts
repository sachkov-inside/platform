import { expect, it } from "vitest";
import { paidGrantSourceRef } from "../../src/modules/billing/domain/paid-grant-source-ref.js";
it("keeps canonical purchase provenance for a single Product and a multi-Product historical purchase", () => {
  const purchase = "10000000-0000-4000-8000-000000000001";
  const product = "20000000-0000-4000-8000-000000000001";
  expect(paidGrantSourceRef(purchase, product, 1)).toBe(
    "payment:10000000-0000-4000-8000-000000000001",
  );
  expect(paidGrantSourceRef(purchase, product, 2)).toBe(
    "payment:10000000-0000-4000-8000-000000000001:product:20000000-0000-4000-8000-000000000001",
  );
});
