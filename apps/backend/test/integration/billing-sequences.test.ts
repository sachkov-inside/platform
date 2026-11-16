import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  boundedSequence,
  checkSequence,
  propertySeeds,
} from "../support/bounded-sequences.js";
import {
  createProductCommerceWorld,
  commerceValue as value,
} from "./setup/product-commerce.js";

type World = Awaited<ReturnType<typeof createProductCommerceWorld>>;
let world: World;
beforeAll(async () => {
  world = await createProductCommerceWorld();
});
afterAll(async () => world.dispose());
const actions = [
  "confirm",
  "authorized",
  "unknown",
  "poll",
  "repeat",
  "duplicate",
  "bank-outage",
] as const;
type Step = (typeof actions)[number];

for (const mode of ["normal", "lost", "unavailable", "unreachable"] as const) {
  test.each(propertySeeds())(
    `payment sequence ${mode}, seed %i preserves Purchase and grants once`,
    async (seed) => {
      await checkSequence(
        seed,
        boundedSequence(seed, actions, 12),
        async (steps: readonly Step[]) => {
          const s = await world.scenario();
          if (mode === "lost") s.loseInit();
          if (mode === "unavailable" || mode === "unreachable")
            s.failNextInit(mode);
          const first = value(await s.payments.purchase(s.buyer, s.command));
          s.answerInit();
          let confirmed = false;
          async function invariant() {
            if (confirmed) value(await s.payments.recover());
            const right = await s.grants.readProductAccess(world.owner, {
              accountId: s.buyer,
              productId: s.productId,
            });
            if (confirmed)
              expect(right).toMatchObject({
                ok: true,
                value: { access: "active", revision: 1 },
              });
            else
              expect(right).toMatchObject({
                ok: false,
                error: { code: "not_found" },
              });
            const repeat = await s.payments.purchase(s.buyer, s.command);
            // An already fulfilled purchase can return existing_access, but never a different Purchase.
            if (repeat.ok)
              expect(repeat.value.purchaseRef).toBe(first.purchaseRef);
            else expect(repeat.error.code).toBe("existing_access");
            expect(s.initCalls()).toBe(mode === "unreachable" ? 0 : 1);
          }
          await invariant();
          for (const step of steps) {
            // Only a bank that received Init can deliver a bound callback.
            if (mode === "unavailable" || mode === "unreachable") {
              value(await s.payments.reconcile(first.purchaseRef));
            } else if (step === "poll") {
              value(await s.payments.reconcile(first.purchaseRef));
            } else if (step === "bank-outage") {
              s.failState();
              await s.payments.reconcile(first.purchaseRef);
            } else if (step === "repeat") {
              await s.payments.purchase(s.buyer, s.command);
            } else if (step === "duplicate") {
              s.setStatus("CONFIRMED");
              await Promise.all([s.notify("CONFIRMED"), s.notify("CONFIRMED")]);
              confirmed = true;
            } else {
              const status =
                step === "confirm"
                  ? "CONFIRMED"
                  : step === "authorized"
                    ? "AUTHORIZED"
                    : "PAY_CHECKING";
              // Old notifications may arrive after the bank's final confirmation.
              if (!confirmed) s.setStatus(status);
              expect(await s.notify(status)).toMatchObject({ ok: true });
              if (step === "confirm") confirmed = true;
            }
            await invariant();
          }
        },
      );
    },
  );
}

test.each(propertySeeds())(
  "unsuccessful bank sequence seed %i never grants access",
  async (seed) => {
    await checkSequence(
      seed,
      boundedSequence(
        seed,
        ["REJECTED", "CANCELED", "PAY_CHECKING", "AUTHORIZED", "NEW"],
        10,
      ),
      async (steps) => {
        const s = await world.scenario();
        const first = value(await s.payments.purchase(s.buyer, s.command));
        for (const status of steps) {
          s.setStatus(status);
          await s.notify(status);
          value(await s.payments.reconcile(first.purchaseRef));
          expect(
            await s.grants.readProductAccess(world.owner, {
              accountId: s.buyer,
              productId: s.productId,
            }),
          ).toMatchObject({ ok: false, error: { code: "not_found" } });
          const repeat = value(await s.payments.purchase(s.buyer, s.command));
          expect(repeat.purchaseRef).toBe(first.purchaseRef);
        }
        expect(s.initCalls()).toBe(1);
      },
    );
  },
);

test.each(propertySeeds())(
  "a retired unsent Purchase never calls Init, seed %i",
  async (seed) => {
    await checkSequence(
      seed,
      boundedSequence(seed, ["reconcile", "recover"], 8),
      async (steps) => {
        const s = await world.scenario();
        const purchaseRef = randomUUID();
        await world.db.prisma.billingPurchase.create({
          data: {
            id: purchaseRef,
            accountId: s.buyer,
            quoteRef: s.quote.quoteRef,
            kind: "one_time",
            state: "prepared",
            lifecycleActive: false,
            environment: s.config.environment,
            terminalRef: s.config.terminalKey,
            amountKopecks: s.quote.snapshot.firstPriceKopecks,
            snapshot: s.quote.snapshot,
            acceptance: { historical: true },
            contact: {},
            fiscalization: "pending",
            createdAt: world.time(),
            updatedAt: world.time(),
          },
        });
        value(await s.payments.reconcile(purchaseRef));
        for (const step of steps) {
          if (step === "reconcile")
            value(await s.payments.reconcile(purchaseRef));
          else value(await s.payments.recover());
          expect(s.initCalls()).toBe(0);
          expect(await s.payments.status(s.buyer, purchaseRef)).toMatchObject({
            ok: true,
            value: { state: "failed", retirementReason: "unsupported_attempt" },
          });
        }
      },
    );
  },
);
