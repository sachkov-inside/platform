import { BillingOperations } from "../../src/modules/billing/index.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";
let world: Awaited<ReturnType<typeof createProductCommerceWorld>>;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());

async function operations() {
  const s = await world.scenario();
  return {
    s,
    owner: new BillingOperations({
      prisma: world.db.prisma,
      accounts: s.accounts,
      pricing: s.pricing,
      payments: s.payments,
      grants: s.grants,
      bank: s.bank,
    }),
  };
}
test("owner reads exact bank history while a buyer cannot use owner operations", async () => {
  const { s, owner } = await operations();
  const purchase = value(await s.payments.purchase(s.buyer, s.command));
  await s.notify("CONFIRMED");
  await s.payments.recover();
  const command = {
    operation: "payments.read",
    operationId: randomUUID(),
    purchaseRef: purchase.purchaseRef,
  };
  expect(await owner.execute(s.buyer, command)).toMatchObject({
    ok: false,
    error: { code: "forbidden" },
  });
  const read = await owner.execute(world.owner, command);
  expect(read).toMatchObject({ ok: true });
  expect(JSON.stringify(read)).not.toContain(s.config.password);
  expect(JSON.stringify(read)).not.toContain(s.config.bindingEncryptionKey);
});
test.each([
  "refunds.decide",
  "refunds.execute",
  "enrollments.assign",
  "tiers.save",
  "tribute.import",
  "invitations.create",
])(
  "removed owner operation %s cannot start an external operation",
  async (operation) => {
    const { s, owner } = await operations();
    expect(
      await owner.execute(world.owner, {
        operation,
        operationId: randomUUID(),
        purchaseRef: randomUUID(),
        amountKopecks: 200000,
        reason: "Rejected obsolete operation",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(s.initCalls()).toBe(0);
  },
);
