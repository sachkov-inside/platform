import { expect, it } from "vitest";
import { paidGrantSourceRef } from "../../src/modules/billing/domain/paid-grant-source-ref.js";

it("keeps the established paid-source identity, including a capability containing a separator", () => {
  expect(
    paidGrantSourceRef("10000000-0000-4000-8000-000000000001", "materials"),
  ).toBe("10000000-0000-4000-8000-000000000001:materials");
  expect(
    paidGrantSourceRef(
      "10000000-0000-4000-8000-000000000001",
      "product:20000000-0000-4000-8000-000000000001",
    ),
  ).toBe(
    "10000000-0000-4000-8000-000000000001:product:20000000-0000-4000-8000-000000000001",
  );
});
