import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPrismaClient, type PlatformPrisma } from "../../src/infrastructure/prisma/index.js";
import { BillingPricing } from "../../src/modules/billing/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
import type { PricingResult } from "../../src/modules/billing/domain/pricing.js";

function value<T>(result: PricingResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const limits = { minimumKopecks: 1, maximumKopecks: 10_000_000 };

describe("Billing catalog, quotes and reservations on PostgreSQL", () => {
  let database: TestDatabase;
  let second: PlatformPrisma;
  let billing: BillingPricing;
  let other: BillingPricing;
  const owner = randomUUID();
  const outsider = randomUUID();
  let now = new Date("2026-09-08T12:00:00Z");
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    second = createPrismaClient(database.url);
    for (const id of [owner, outsider]) await database.prisma.account.create({ data: { id, logtoIssuer: "https://identity.invalid", logtoSubject: id } });
    await database.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    const accounts = assembleAccounts({ prisma: database.prisma, emailFingerprintKey: "billing-test-key-00000000000000000000" });
    billing = new BillingPricing({ prisma: database.prisma, accounts, clock: () => now });
    other = new BillingPricing({ prisma: second, accounts, clock: () => now });
  });
  afterAll(async () => { await second.$disconnect(); await database.dispose(); });
  async function catalog(priceKopecks = 200_000, months = 3) {
    const offerId = randomUUID(); const optionId = randomUUID();
    value(await billing.manage(owner, { operation: "offers.save", operationId: randomUUID(), value: { id: offerId, name: "Материалы", benefits: ["materials"] } }));
    value(await billing.manage(owner, { operation: "paymentOptions.save", operationId: randomUUID(), value: { id: optionId, offerId, months, priceKopecks } }));
    return { offerId, optionId };
  }
  async function promo(optionId: string, percent: number, usageLimit: number | null = null, code: string | null = null) {
    const promotion = { id: randomUUID(), name: "Старт", percent, code, startsAt: "2026-09-01T00:00:00+03:00", endsAt: "2026-10-01T00:00:00+03:00", offerIds: [], paymentOptionIds: [optionId], usageLimit };
    value(await billing.manage(owner, { operation: "promotions.save", operationId: randomUUID(), value: promotion }));
    return promotion;
  }
  async function quote(accountId: string, optionId: string, promoCode?: string) {
    return value(await billing.quote(accountId, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1, ...(promoCode ? { promoCode } : {}) }));
  }
  async function reserve(accountId: string, optionId: string, promoCode?: string) {
    const q = await quote(accountId, optionId, promoCode);
    const command = { accountId, purchaseRef: randomUUID(), quoteRef: q.quoteRef, amountLimits: limits };
    value(await billing.reserve(command));
    return command;
  }

  test("owner authorization is current on replay; strict schema and optimistic revisions protect catalog", async () => {
    const cmd = { operation: "offers.save", operationId: randomUUID(), value: { id: randomUUID(), name: "Inside", benefits: ["materials"] } };
    expect(await billing.manage(outsider, cmd)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await billing.manage(owner, { ...cmd, actor: owner })).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    const first = value(await billing.manage(owner, cmd));
    expect(await billing.manage(owner, cmd)).toEqual({ ok: true, value: first });
    expect(await billing.manage(owner, { ...cmd, value: { ...cmd.value, name: "Different" } })).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
    const edit = { ...cmd, operationId: randomUUID(), expectedRevision: 1, value: { ...cmd.value, name: "New" } };
    const results = await Promise.all([billing.manage(owner, edit), other.manage(owner, { ...edit, operationId: randomUUID() })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: { code: "revision_conflict" } });
    await database.prisma.accountPermission.delete({ where: { accountId_permission: { accountId: owner, permission: "platform:admin" } } });
    expect(await billing.manage(owner, cmd)).toMatchObject({ error: { code: "forbidden" } });
    await database.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
  });

  test("concurrent owner writes do not exhaust the pool; equal offset instants replay", async () => {
    const commands = Array.from({ length: 12 }, () => ({ operation: "offers.save", operationId: randomUUID(), value: { id: randomUUID(), name: "Concurrent", benefits: ["materials"] } }));
    const writes = await Promise.all(commands.map((command) => billing.manage(owner, command)));
    expect(writes.every((result) => result.ok)).toBe(true);
    const { optionId } = await catalog();
    const promotion = await promo(optionId, 10);
    const cmd = { operation: "promotions.save", operationId: randomUUID(), expectedRevision: 1, value: promotion };
    const saved = await billing.manage(owner, cmd);
    expect(saved.ok).toBe(true);
    expect(await billing.manage(owner, { ...cmd, value: { ...promotion, startsAt: new Date(promotion.startsAt).toISOString(), endsAt: new Date(promotion.endsAt).toISOString() } })).toEqual(saved);
  });

  test("best single public/code discount, amount rounding, unchanged renewal and immutable quote replay", async () => {
    const { optionId } = await catalog(100_001, 7);
    await promo(optionId, 10);
    const code = `CODE-${randomUUID()}`;
    await promo(optionId, 25, null, code);
    const accountId = randomUUID();
    const cmd = { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1, promoCode: code };
    const result = value(await billing.quote(accountId, cmd));
    expect(result.snapshot).toMatchObject({ firstPriceKopecks: 75_001, renewalPriceKopecks: 100_001, paymentOption: { months: 7 }, promotion: { percent: 25 } });
    expect(JSON.stringify(result)).not.toContain(code);
    expect((await quote(randomUUID(), optionId)).snapshot.firstPriceKopecks).toBe(90_001);
    expect(await billing.quote(accountId, cmd)).toEqual({ ok: true, value: result });
    expect(await billing.quote(accountId, { ...cmd, promoCode: "different" })).toMatchObject({ error: { code: "operation_conflict" } });
    expect((await quote(randomUUID(), optionId, "wrong-code")).snapshot.firstPriceKopecks).toBe(90_001);
  });

  test("concurrent last-use purchases, one consumption on duplicate confirmation and unknown retention", async () => {
    const { optionId } = await catalog();
    const promotion = await promo(optionId, 50, 1);
    const accounts = [randomUUID(), randomUUID()];
    const quotes = await Promise.all(accounts.map((id) => quote(id, optionId)));
    const commands = accounts.map((accountId, i) => ({ accountId, quoteRef: required(quotes[i]).quoteRef, purchaseRef: randomUUID(), amountLimits: limits }));
    const results = await Promise.all([billing.reserve(required(commands[0])), other.reserve(required(commands[1]))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: { code: "quote_changed" } });
    const winner = required(commands[results.findIndex((r) => r.ok)]);
    expect(await billing.reserve(winner)).toEqual(results.find((r) => r.ok));
    value(await billing.settle({ ...pick(winner), state: "sent" }));
    value(await billing.settle({ ...pick(winner), state: "unknown" }));
    const oldNow = now; now = new Date("2027-01-01T00:00:00Z");
    expect((await database.prisma.billingPromoReservation.findUniqueOrThrow({ where: { purchaseRef: winner.purchaseRef } })).state).toBe("unknown");
    const unknown = await quote(winner.accountId, optionId);
    expect(await billing.reserve({ ...winner, quoteRef: unknown.quoteRef, purchaseRef: randomUUID() })).toMatchObject({ error: { code: "reservation_conflict" } });
    now = oldNow;
    const confirmations = await Promise.all([billing.settle({ ...pick(winner), state: "confirmed" }), other.settle({ ...pick(winner), state: "confirmed" })]);
    expect(confirmations.every((r) => r.ok)).toBe(true);
    expect(await database.prisma.billingPromoReservation.count({ where: { promotionId: promotion.id, state: "confirmed" } })).toBe(1);
    expect(await billing.settle({ ...pick(winner), state: "failed" })).toMatchObject({ error: { code: "reservation_conflict" } });
    expect((await quote(randomUUID(), optionId)).snapshot.promotion).toBeNull();
  });

  test("definitive failure releases capacity; same Account can use discount on a later new lifecycle", async () => {
    const { optionId } = await catalog(); await promo(optionId, 50, 2);
    const accountId = randomUUID();
    const first = await reserve(accountId, optionId);
    value(await billing.settle({ ...pick(first), state: "failed" }));
    const next = await reserve(accountId, optionId);
    value(await billing.settle({ ...pick(next), state: "sent" }));
    value(await billing.settle({ ...pick(next), state: "confirmed" }));
    // #407 invokes reserve again only after its subscription lifecycle has ended.
    const later = await reserve(accountId, optionId);
    expect(value(await billing.reserve(later)).firstPriceKopecks).toBe(100_000);
    value(await billing.settle({ ...pick(later), state: "failed" }));
    expect(await billing.reserve({ ...first, purchaseRef: randomUUID() })).toMatchObject({ error: { code: "reservation_conflict" } });
  });

  test("changed prices, promotion revisions and expiry require a new quote before reservation", async () => {
    const { offerId, optionId } = await catalog();
    const accountId = randomUUID(); const q = await quote(accountId, optionId);
    value(await billing.manage(owner, { operation: "paymentOptions.save", operationId: randomUUID(), expectedRevision: 1, value: { id: optionId, offerId, months: 3, priceKopecks: 300_000 } }));
    expect(await billing.reserve({ accountId, quoteRef: q.quoteRef, purchaseRef: randomUUID(), amountLimits: limits })).toMatchObject({ error: { code: "quote_changed" } });
    const another = await catalog(); const promotion = await promo(another.optionId, 10);
    const p = await quote(accountId, another.optionId);
    value(await billing.manage(owner, { operation: "promotions.archive", operationId: randomUUID(), expectedRevision: 1, id: promotion.id }));
    expect(await billing.reserve({ accountId, quoteRef: p.quoteRef, purchaseRef: randomUUID(), amountLimits: limits })).toMatchObject({ error: { code: "quote_changed" } });
    const fresh = await quote(accountId, another.optionId);
    const oldNow = now; now = new Date(fresh.expiresAt);
    expect(await billing.reserve({ accountId, quoteRef: fresh.quoteRef, purchaseRef: randomUUID(), amountLimits: limits })).toMatchObject({ error: { code: "quote_expired" } });
    now = oldNow;
  });

  test("archive/edit preserve accepted conditions and history; limit cannot shrink below committed usage", async () => {
    const { offerId, optionId } = await catalog(); const promotion = await promo(optionId, 50, 1);
    const reservation = await reserve(randomUUID(), optionId);
    const snapshot = value(await billing.reserve(reservation));
    expect(await billing.manage(owner, { operation: "promotions.save", operationId: randomUUID(), expectedRevision: 1, value: { ...promotion, usageLimit: 1 } })).toMatchObject({ ok: true });
    value(await billing.manage(owner, { operation: "offers.archive", operationId: randomUUID(), expectedRevision: 1, id: offerId }));
    value(await billing.manage(owner, { operation: "paymentOptions.archive", operationId: randomUUID(), expectedRevision: 1, id: optionId }));
    value(await billing.manage(owner, { operation: "promotions.archive", operationId: randomUUID(), expectedRevision: 2, id: promotion.id }));
    expect(value(await billing.reserve(reservation))).toEqual(snapshot);
    expect(await billing.quote(randomUUID(), { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 2 })).toMatchObject({ error: { code: "not_found" } });
    value(await billing.settle({ ...pick(reservation), state: "sent" }));
    value(await billing.settle({ ...pick(reservation), state: "confirmed" }));
    expect(value(await billing.reserve(reservation))).toEqual(snapshot);
  });

  test("zero/negative prices, 100% discount and unconfirmed/out-of-range terminal limits fail closed", async () => {
    const { offerId, optionId } = await catalog();
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(await billing.manage(owner, { operation: "paymentOptions.save", operationId: randomUUID(), value: { id: randomUUID(), offerId, months: 1, priceKopecks: amount } })).toMatchObject({ error: { code: "invalid_request" } });
    const accountId = randomUUID(); const q = await quote(accountId, optionId);
    for (const amountLimits of [null, { minimumKopecks: 1, maximumKopecks: 100 }, { minimumKopecks: 300_000, maximumKopecks: 400_000 }]) expect(await billing.reserve({ accountId, quoteRef: q.quoteRef, purchaseRef: randomUUID(), amountLimits })).toMatchObject({ error: { code: "unsupported_amount" } });
    const free = await promo(optionId, 100);
    expect(await billing.quote(accountId, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 })).toMatchObject({ error: { code: "unsupported_amount" } });
    value(await billing.manage(owner, { operation: "promotions.archive", operationId: randomUUID(), expectedRevision: 1, id: free.id }));
  });

  test("quote ownership, changed operation IDs, strict bounds and transactional rollback", async () => {
    const { optionId } = await catalog(); const accountId = randomUUID(); const q = await quote(accountId, optionId);
    expect(await billing.reserve({ accountId: randomUUID(), quoteRef: q.quoteRef, purchaseRef: randomUUID(), amountLimits: limits })).toMatchObject({ error: { code: "not_found" } });
    expect(await billing.offers({ limit: 101 })).toMatchObject({ error: { code: "invalid_request" } });
    const page = value(await billing.offers({ limit: 1 }));
    expect(page.items).toHaveLength(1); expect(page.nextCursor).not.toBeNull();
    const next = value(await billing.offers({ limit: 1, cursor: page.nextCursor }));
    expect(next.items[0]?.paymentOption.id).not.toBe(page.items[0]?.paymentOption.id);
    const admin = new Pool({ connectionString: database.url });
    try {
      await admin.query("CREATE FUNCTION billing.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$");
      await admin.query("CREATE TRIGGER reject_receipt BEFORE INSERT ON billing.pricing_commands FOR EACH ROW EXECUTE FUNCTION billing.reject_receipt()");
      const id = randomUUID();
      expect(await billing.manage(owner, { operation: "offers.save", operationId: randomUUID(), value: { id, name: "Rollback", benefits: ["materials"] } })).toMatchObject({ error: { code: "dependency_unavailable" } });
      expect(await database.prisma.billingOffer.findUnique({ where: { id } })).toBeNull();
      await admin.query("DROP TRIGGER reject_receipt ON billing.pricing_commands");
      await admin.query("DROP FUNCTION billing.reject_receipt()");
      await expect(database.prisma.billingPaymentOption.update({ where: { id: optionId }, data: { priceKopecks: 0 } })).rejects.toThrow();
    } finally { await admin.end(); }
  });
});
function pick(command: { accountId: string; purchaseRef: string }) { return { accountId: command.accountId, purchaseRef: command.purchaseRef }; }

function required<T>(input: T | undefined): T { if (input === undefined) throw new Error("Missing test fixture"); return input; }
