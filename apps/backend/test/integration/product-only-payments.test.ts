import { expect, test } from "vitest";
import { BillingPayments } from "../../src/modules/billing/index.js";

test("Product payments expose no recurring charge capability", () => {
  const capabilities = Object.getOwnPropertyNames(BillingPayments.prototype);
  expect(capabilities).not.toContain("renew");
  expect(capabilities).not.toContain("prepareRenewal");
  expect(capabilities).not.toContain("chargeSaved");
  expect(capabilities).not.toContain("subscriptionEmail");
});
