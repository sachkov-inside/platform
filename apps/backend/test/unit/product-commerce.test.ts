import { expect, test } from "vitest";
import { saleCapability } from "../../src/modules/billing/domain/sale-capability.js";
import { paymentAdmission } from "../../src/modules/billing/shared/payment-admission.js";
const terminal = { minimumKopecks: 100, maximumKopecks: 100000 };
test("sale admission needs a configured terminal and the independent sales gate", () => {
  expect(saleCapability(terminal, true)).toEqual({ payments: true });
  expect(saleCapability(undefined, true)).toEqual({ payments: false });
  expect(saleCapability(terminal, false)).toEqual({ payments: false });
});
