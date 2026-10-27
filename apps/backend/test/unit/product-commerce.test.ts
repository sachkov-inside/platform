import { expect, test } from "vitest";
import { saleCapability } from "../../src/modules/billing/domain/sale-capability.js";

const terminal = { minimumKopecks: 100, maximumKopecks: 100000 };
test("sale admission needs a configured terminal and the independent sales gate", () => {
  expect(saleCapability(terminal, true)).toMatchObject({ payments: true });
  expect(saleCapability(undefined, true)).toMatchObject({ payments: false });
  expect(saleCapability(terminal, false)).toMatchObject({ payments: false });
});
