import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createPrismaClient,
  type PlatformPrisma,
} from "../../src/infrastructure/prisma/index.js";
import { BillingPricing } from "../../src/modules/billing/index.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
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
    for (const id of [owner, outsider])
      await database.prisma.account.create({
        data: { id, logtoIssuer: "https://identity.invalid", logtoSubject: id },
      });
    await database.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    const accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: "billing-test-key-00000000000000000000",
    });
    billing = new BillingPricing({
      prisma: database.prisma,
      accounts,
      clock: () => now,
      sale: { payments: true, subscriptions: true },
    });
    other = new BillingPricing({
      prisma: second,
      accounts,
      clock: () => now,
      sale: { payments: true, subscriptions: true },
    });
  });
  afterAll(async () => {
    await second.$disconnect();
    await database.dispose();
  });
  async function catalog(priceKopecks = 200_000, months = 3) {
    const offerId = randomUUID();
    const optionId = randomUUID();
    value(
      await billing.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: offerId,
          name: "Материалы",
          benefits: ["materials"],
          contentScope: { guideIds: [randomUUID()], materialIds: [] },
        },
      }),
    );
    value(
      await billing.manage(owner, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        value: { id: optionId, offerId, months, priceKopecks },
      }),
    );
    value(
      await billing.manage(owner, {
        operation: "offers.publish",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: offerId,
      }),
    );
    return { offerId, optionId };
  }
  async function promo(
    optionId: string,
    percent: number,
    usageLimit: number | null = null,
    code: string | null = null,
  ) {
    const promotion = {
      id: randomUUID(),
      name: "Старт",
      percent,
      code,
      startsAt: "2026-09-01T00:00:00+03:00",
      endsAt: "2026-10-01T00:00:00+03:00",
      offerIds: [],
      paymentOptionIds: [optionId],
      usageLimit,
    };
    value(
      await billing.manage(owner, {
        operation: "promotions.save",
        operationId: randomUUID(),
        value: promotion,
      }),
    );
    return promotion;
  }
  async function quote(
    accountId: string,
    optionId: string,
    promoCode?: string,
  ) {
    return value(
      await billing.quote(accountId, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        ...(promoCode ? { promoCode } : {}),
      }),
    );
  }
  async function reserve(
    accountId: string,
    optionId: string,
    promoCode?: string,
  ) {
    const q = await quote(accountId, optionId, promoCode);
    const command = {
      accountId,
      purchaseRef: randomUUID(),
      quoteRef: q.quoteRef,
      amountLimits: limits,
    };
    value(await billing.reserve(command));
    return command;
  }

  test("owner authorization is current on replay; strict schema and optimistic revisions protect catalog", async () => {
    const cmd = {
      operation: "offers.save",
      operationId: randomUUID(),
      value: { id: randomUUID(), name: "Inside", benefits: ["materials"] },
    };
    expect(await billing.manage(outsider, cmd)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await billing.manage(owner, { ...cmd, actor: owner })).toMatchObject(
      { ok: false, error: { code: "invalid_request" } },
    );
    const first = value(await billing.manage(owner, cmd));
    expect(await billing.manage(owner, cmd)).toEqual({
      ok: true,
      value: first,
    });
    expect(
      await billing.manage(owner, {
        ...cmd,
        value: { ...cmd.value, name: "Different" },
      }),
    ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
    const edit = {
      ...cmd,
      operationId: randomUUID(),
      expectedRevision: 1,
      value: { ...cmd.value, name: "New" },
    };
    const results = await Promise.all([
      billing.manage(owner, edit),
      other.manage(owner, { ...edit, operationId: randomUUID() }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      error: { code: "revision_conflict" },
    });
    await database.prisma.accountPermission.delete({
      where: {
        accountId_permission: {
          accountId: owner,
          permission: "platform:admin",
        },
      },
    });
    expect(await billing.manage(owner, cmd)).toMatchObject({
      error: { code: "forbidden" },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
  });

  test("concurrent owner writes do not exhaust the pool; equal offset instants replay", async () => {
    const commands = Array.from({ length: 12 }, () => ({
      operation: "offers.save",
      operationId: randomUUID(),
      value: { id: randomUUID(), name: "Concurrent", benefits: ["materials"] },
    }));
    const writes = await Promise.all(
      commands.map((command) => billing.manage(owner, command)),
    );
    expect(writes.every((result) => result.ok)).toBe(true);
    const { optionId } = await catalog();
    const promotion = await promo(optionId, 10);
    const cmd = {
      operation: "promotions.save",
      operationId: randomUUID(),
      expectedRevision: 1,
      value: promotion,
    };
    const saved = await billing.manage(owner, cmd);
    expect(saved.ok).toBe(true);
    expect(
      await billing.manage(owner, {
        ...cmd,
        value: {
          ...promotion,
          startsAt: new Date(promotion.startsAt).toISOString(),
          endsAt: new Date(promotion.endsAt).toISOString(),
        },
      }),
    ).toEqual(saved);
  });

  test("best single public/code discount, amount rounding, unchanged renewal and immutable quote replay", async () => {
    const { optionId } = await catalog(100_001, 7);
    await promo(optionId, 10);
    const code = `CODE-${randomUUID()}`;
    await promo(optionId, 25, null, code);
    const accountId = randomUUID();
    const cmd = {
      operationId: randomUUID(),
      paymentOptionId: optionId,
      optionRevision: 1,
      promoCode: code,
    };
    const result = value(await billing.quote(accountId, cmd));
    expect(result.snapshot).toMatchObject({
      firstPriceKopecks: 75_001,
      renewalPriceKopecks: 100_001,
      paymentOption: { months: 7 },
      promotion: { percent: 25 },
    });
    expect(JSON.stringify(result)).not.toContain(code);
    expect(
      (await quote(randomUUID(), optionId)).snapshot.firstPriceKopecks,
    ).toBe(90_001);
    expect(await billing.quote(accountId, cmd)).toEqual({
      ok: true,
      value: result,
    });
    expect(
      await billing.quote(accountId, { ...cmd, promoCode: "different" }),
    ).toMatchObject({ error: { code: "operation_conflict" } });
    expect(
      (await quote(randomUUID(), optionId, "wrong-code")).snapshot
        .firstPriceKopecks,
    ).toBe(90_001);
    // A quote stored before #732 holds the command's JSON text; the same command in another key
    // order still replays it, and a changed one still conflicts.
    await database.prisma.billingPriceQuote.update({
      where: {
        accountId_operationId: { accountId, operationId: cmd.operationId },
      },
      data: { fingerprint: JSON.stringify(cmd) },
    });
    const reordered = {
      promoCode: code,
      optionRevision: 1,
      paymentOptionId: optionId,
      operationId: cmd.operationId,
    };
    expect(await billing.quote(accountId, reordered)).toEqual({
      ok: true,
      value: result,
    });
    expect(
      await billing.quote(accountId, { ...cmd, promoCode: "different" }),
    ).toMatchObject({ error: { code: "operation_conflict" } });
  });

  test("concurrent last-use purchases, one consumption on duplicate confirmation and unknown retention", async () => {
    const { optionId } = await catalog();
    const promotion = await promo(optionId, 50, 1);
    const accounts = [randomUUID(), randomUUID()];
    const quotes = await Promise.all(accounts.map((id) => quote(id, optionId)));
    const commands = accounts.map((accountId, i) => ({
      accountId,
      quoteRef: required(quotes[i]).quoteRef,
      purchaseRef: randomUUID(),
      amountLimits: limits,
    }));
    const results = await Promise.all([
      billing.reserve(required(commands[0])),
      other.reserve(required(commands[1])),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      error: { code: "quote_changed" },
    });
    const winner = required(commands[results.findIndex((r) => r.ok)]);
    expect(await billing.reserve(winner)).toEqual(results.find((r) => r.ok));
    value(await billing.settle({ ...pick(winner), state: "sent" }));
    value(await billing.settle({ ...pick(winner), state: "unknown" }));
    const oldNow = now;
    now = new Date("2027-01-01T00:00:00Z");
    expect(
      (
        await database.prisma.billingPromoReservation.findUniqueOrThrow({
          where: { purchaseRef: winner.purchaseRef },
        })
      ).state,
    ).toBe("unknown");
    const unknown = await quote(winner.accountId, optionId);
    expect(
      await billing.reserve({
        ...winner,
        quoteRef: unknown.quoteRef,
        purchaseRef: randomUUID(),
      }),
    ).toMatchObject({ error: { code: "reservation_conflict" } });
    now = oldNow;
    const confirmations = await Promise.all([
      billing.settle({ ...pick(winner), state: "confirmed" }),
      other.settle({ ...pick(winner), state: "confirmed" }),
    ]);
    expect(confirmations.every((r) => r.ok)).toBe(true);
    expect(
      await database.prisma.billingPromoReservation.count({
        where: { promotionId: promotion.id, state: "confirmed" },
      }),
    ).toBe(1);
    expect(
      await billing.settle({ ...pick(winner), state: "failed" }),
    ).toMatchObject({ error: { code: "reservation_conflict" } });
    expect((await quote(randomUUID(), optionId)).snapshot.promotion).toBeNull();
  });

  test("definitive failure releases capacity; same Account can use discount on a later new lifecycle", async () => {
    const { optionId } = await catalog();
    await promo(optionId, 50, 2);
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
    expect(
      await billing.reserve({ ...first, purchaseRef: randomUUID() }),
    ).toMatchObject({ error: { code: "reservation_conflict" } });
  });

  test("changed prices, promotion revisions and expiry require a new quote before reservation", async () => {
    const { offerId, optionId } = await catalog();
    const accountId = randomUUID();
    const q = await quote(accountId, optionId);
    value(
      await billing.manage(owner, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        expectedRevision: 1,
        value: { id: optionId, offerId, months: 3, priceKopecks: 300_000 },
      }),
    );
    expect(
      await billing.reserve({
        accountId,
        quoteRef: q.quoteRef,
        purchaseRef: randomUUID(),
        amountLimits: limits,
      }),
    ).toMatchObject({ error: { code: "quote_changed" } });
    const another = await catalog();
    const promotion = await promo(another.optionId, 10);
    const p = await quote(accountId, another.optionId);
    value(
      await billing.manage(owner, {
        operation: "promotions.archive",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: promotion.id,
      }),
    );
    expect(
      await billing.reserve({
        accountId,
        quoteRef: p.quoteRef,
        purchaseRef: randomUUID(),
        amountLimits: limits,
      }),
    ).toMatchObject({ error: { code: "quote_changed" } });
    const fresh = await quote(accountId, another.optionId);
    const oldNow = now;
    now = new Date(fresh.expiresAt);
    expect(
      await billing.reserve({
        accountId,
        quoteRef: fresh.quoteRef,
        purchaseRef: randomUUID(),
        amountLimits: limits,
      }),
    ).toMatchObject({ error: { code: "quote_expired" } });
    now = oldNow;
  });

  test("archive/edit preserve accepted conditions and history; limit cannot shrink below committed usage", async () => {
    const { offerId, optionId } = await catalog();
    const promotion = await promo(optionId, 50, 1);
    const reservation = await reserve(randomUUID(), optionId);
    const snapshot = value(await billing.reserve(reservation));
    expect(
      await billing.manage(owner, {
        operation: "promotions.save",
        operationId: randomUUID(),
        expectedRevision: 1,
        value: { ...promotion, usageLimit: 1 },
      }),
    ).toMatchObject({ ok: true });
    value(
      await billing.manage(owner, {
        operation: "offers.archive",
        operationId: randomUUID(),
        expectedRevision: 2,
        id: offerId,
      }),
    );
    value(
      await billing.manage(owner, {
        operation: "paymentOptions.archive",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: optionId,
      }),
    );
    value(
      await billing.manage(owner, {
        operation: "promotions.archive",
        operationId: randomUUID(),
        expectedRevision: 2,
        id: promotion.id,
      }),
    );
    expect(value(await billing.reserve(reservation))).toEqual(snapshot);
    expect(
      await billing.quote(randomUUID(), {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 2,
      }),
    ).toMatchObject({ error: { code: "not_found" } });
    value(await billing.settle({ ...pick(reservation), state: "sent" }));
    value(await billing.settle({ ...pick(reservation), state: "confirmed" }));
    expect(value(await billing.reserve(reservation))).toEqual(snapshot);
  });

  test("an unconfirmed terminal refuses to put a subscription on sale but sells a one-time option", async () => {
    const accounts = assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: "billing-test-key-00000000000000000000",
    });
    // Процесс без терминала или адреса для чека не включает в продажу ничего, даже разовый вариант.
    const unconfigured = new BillingPricing({
      prisma: database.prisma,
      accounts,
      clock: () => now,
      sale: { payments: false, subscriptions: false },
    });
    const unsold = randomUUID(),
      unsoldCapability = `guide:${randomUUID()}`;
    value(
      await unconfigured.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: unsold,
          name: "Руководство",
          benefits: [unsoldCapability, "support"],
          benefitPeriods: [
            { capability: unsoldCapability, months: null },
            { capability: "support", months: 6 },
          ],
        },
      }),
    );
    value(
      await unconfigured.manage(owner, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        value: {
          id: randomUUID(),
          offerId: unsold,
          mode: "one_time",
          months: 1,
          priceKopecks: 100_000,
        },
      }),
    );
    expect(
      await unconfigured.manage(owner, {
        operation: "offers.publish",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: unsold,
      }),
    ).toMatchObject({ ok: false, error: { code: "method_unavailable" } });
    // Все способы формы включены: карта-only и автосписания не подтверждены.
    const allMethods = new BillingPricing({
      prisma: database.prisma,
      accounts,
      clock: () => now,
      sale: { payments: true, subscriptions: false },
    });
    const onSale = async (mode: "subscription" | "one_time") =>
      value(await billing.offers({ mode })).items.map((item) => item.offer.id);
    const save = (
      offerId: string,
      mode: "subscription" | "one_time",
      id = randomUUID(),
    ) =>
      allMethods.manage(owner, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        value: { id, offerId, mode, months: 1, priceKopecks: 100_000 },
      });

    const subscription = randomUUID();
    value(
      await allMethods.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: subscription,
          name: "Материалы",
          benefits: ["materials"],
          contentScope: { guideIds: [randomUUID()], materialIds: [] },
        },
      }),
    );
    value(await save(subscription, "subscription"));
    expect(
      await allMethods.manage(owner, {
        operation: "offers.publish",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: subscription,
      }),
    ).toMatchObject({ ok: false, error: { code: "method_unavailable" } });
    expect(await onSale("subscription")).not.toContain(subscription);

    const guide = randomUUID(),
      capability = `guide:${randomUUID()}`;
    value(
      await allMethods.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: guide,
          name: "Руководство",
          benefits: [capability, "support"],
          benefitPeriods: [
            { capability, months: null },
            { capability: "support", months: 6 },
          ],
        },
      }),
    );
    value(await save(guide, "one_time"));
    expect(
      value(
        await allMethods.manage(owner, {
          operation: "offers.publish",
          operationId: randomUUID(),
          expectedRevision: 1,
          id: guide,
        }),
      ),
    ).toMatchObject({ published: true });
    expect(await onSale("one_time")).toContain(guide);
    // Продажа подписки не включается и обходным путём — вариантом, добавленным к уже продаваемому предложению.
    const sneaked = randomUUID();
    expect(await save(guide, "subscription", sneaked)).toMatchObject({
      ok: false,
      error: { code: "method_unavailable" },
    });
    expect(
      await database.prisma.billingPaymentOption.findUnique({
        where: { id: sneaked },
      }),
    ).toBeNull();
    value(await save(guide, "one_time"));

    // Тот же каталог на подтверждённом терминале включает подписку обычной командой.
    const confirmed = new BillingPricing({
      prisma: database.prisma,
      accounts,
      clock: () => now,
      sale: { payments: true, subscriptions: true },
    });
    expect(
      value(
        await confirmed.manage(owner, {
          operation: "offers.publish",
          operationId: randomUUID(),
          expectedRevision: 1,
          id: subscription,
        }),
      ),
    ).toMatchObject({ published: true });
    expect(await onSale("subscription")).toContain(subscription);
  });

  test("zero/negative prices, 100% discount and unconfirmed/out-of-range terminal limits fail closed", async () => {
    const { offerId, optionId } = await catalog();
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        await billing.manage(owner, {
          operation: "paymentOptions.save",
          operationId: randomUUID(),
          value: { id: randomUUID(), offerId, months: 1, priceKopecks: amount },
        }),
      ).toMatchObject({ error: { code: "invalid_request" } });
    const accountId = randomUUID();
    const q = await quote(accountId, optionId);
    for (const amountLimits of [
      null,
      { minimumKopecks: 1, maximumKopecks: 100 },
      { minimumKopecks: 300_000, maximumKopecks: 400_000 },
    ])
      expect(
        await billing.reserve({
          accountId,
          quoteRef: q.quoteRef,
          purchaseRef: randomUUID(),
          amountLimits,
        }),
      ).toMatchObject({ error: { code: "unsupported_amount" } });
    const free = await promo(optionId, 100);
    expect(
      await billing.quote(accountId, {
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
      }),
    ).toMatchObject({ error: { code: "unsupported_amount" } });
    value(
      await billing.manage(owner, {
        operation: "promotions.archive",
        operationId: randomUUID(),
        expectedRevision: 1,
        id: free.id,
      }),
    );
  });

  test("quote ownership, changed operation IDs, strict bounds and transactional rollback", async () => {
    const { optionId } = await catalog();
    const accountId = randomUUID();
    const q = await quote(accountId, optionId);
    expect(
      await billing.reserve({
        accountId: randomUUID(),
        quoteRef: q.quoteRef,
        purchaseRef: randomUUID(),
        amountLimits: limits,
      }),
    ).toMatchObject({ error: { code: "not_found" } });
    expect(await billing.offers({ limit: 101 })).toMatchObject({
      error: { code: "invalid_request" },
    });
    const page = value(await billing.offers({ limit: 1 }));
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = value(
      await billing.offers({ limit: 1, cursor: page.nextCursor }),
    );
    expect(next.items[0]?.paymentOption.id).not.toBe(
      page.items[0]?.paymentOption.id,
    );
    const admin = new Pool({ connectionString: database.url });
    try {
      await admin.query(
        "CREATE FUNCTION billing.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$",
      );
      await admin.query(
        "CREATE TRIGGER reject_receipt BEFORE INSERT ON billing.pricing_commands FOR EACH ROW EXECUTE FUNCTION billing.reject_receipt()",
      );
      const id = randomUUID();
      expect(
        await billing.manage(owner, {
          operation: "offers.save",
          operationId: randomUUID(),
          value: { id, name: "Rollback", benefits: ["materials"] },
        }),
      ).toMatchObject({ error: { code: "dependency_unavailable" } });
      expect(
        await database.prisma.billingOffer.findUnique({ where: { id } }),
      ).toBeNull();
      await admin.query(
        "DROP TRIGGER reject_receipt ON billing.pricing_commands",
      );
      await admin.query("DROP FUNCTION billing.reject_receipt()");
      await expect(
        database.prisma.billingPaymentOption.update({
          where: { id: optionId },
          data: { priceKopecks: 0 },
        }),
      ).rejects.toThrow();
    } finally {
      await admin.end();
    }
  });
});
/**
 * Признак «подписка продаётся» читается по всему каталогу, поэтому у него своя база: соседние
 * проверки файла заводят продаваемые варианты и сделали бы ответ заранее известным.
 */
describe("признак продажи подписки на собственном каталоге", () => {
  let database: TestDatabase;
  let billing: BillingPricing;
  const owner = randomUUID();
  const now = new Date("2026-09-08T12:00:00Z");
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.account.create({
      data: {
        id: owner,
        logtoIssuer: "https://identity.invalid",
        logtoSubject: owner,
      },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: owner, permission: "billing:manage" },
    });
    billing = new BillingPricing({
      prisma: database.prisma,
      accounts: assembleAccounts({
        prisma: database.prisma,
        emailFingerprintKey: "billing-sale-key-0000000000000000000",
      }),
      clock: () => now,
      sale: { payments: true, subscriptions: true },
    });
  });
  afterAll(async () => {
    await database.dispose();
  });
  async function offer(input: {
    readonly benefits: readonly string[];
    readonly mode: "subscription" | "one_time";
    readonly contentScope?: { guideIds: string[]; materialIds: string[] };
    readonly benefitPeriods?: { capability: string; months: number | null }[];
  }) {
    const offerId = randomUUID();
    const optionId = randomUUID();
    value(
      await billing.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: offerId,
          name: "Предложение",
          benefits: [...input.benefits],
          ...(input.contentScope === undefined
            ? {}
            : { contentScope: input.contentScope }),
          ...(input.benefitPeriods === undefined
            ? {}
            : { benefitPeriods: input.benefitPeriods }),
        },
      }),
    );
    value(
      await billing.manage(owner, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        value: {
          id: optionId,
          offerId,
          mode: input.mode,
          months: 1,
          priceKopecks: 100_000,
        },
      }),
    );
    return {
      offerId,
      optionId,
      publish: () =>
        billing.manage(owner, {
          operation: "offers.publish",
          operationId: randomUUID(),
          expectedRevision: 1,
          id: offerId,
        }),
    };
  }

  test("разовое предложение продукта и тариф без состава не делают подписку продаваемой", async () => {
    const guide = randomUUID();
    expect(await billing.hasOffersForSale()).toBe(false);
    // Продаётся только продукт: призыв к подписке не должен появиться нигде.
    const product = await offer({
      benefits: [`guide:${guide}`, "support"],
      mode: "one_time",
      benefitPeriods: [{ capability: "support", months: 6 }],
    });
    value(await product.publish());
    expect(await billing.hasOffersForSale()).toBe(false);
    // Тариф без состава открыл бы пустоту: каталог не включает его в продажу.
    const empty = await offer({
      benefits: ["materials"],
      mode: "subscription",
    });
    expect(await empty.publish()).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    const explicitlyEmpty = await offer({
      benefits: ["materials", "community"],
      mode: "subscription",
      contentScope: { guideIds: [], materialIds: [] },
    });
    expect(await explicitlyEmpty.publish()).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    // Строка, включённая в продажу в обход каталога, не продаётся и не включает признак.
    await database.prisma.billingOffer.update({
      where: { id: empty.offerId },
      data: { published: true },
    });
    expect(await billing.hasOffersForSale()).toBe(false);
    expect(
      await billing.quote(randomUUID(), {
        operationId: randomUUID(),
        paymentOptionId: empty.optionId,
        optionRevision: 1,
      }),
    ).toMatchObject({ error: { code: "not_found" } });
    expect(value(await billing.offers({ mode: "subscription" })).items).toEqual(
      [],
    );
    // Подписка с явным составом продаётся, и только она включает признак.
    const sold = await offer({
      benefits: ["materials"],
      mode: "subscription",
      contentScope: { guideIds: [guide], materialIds: [] },
    });
    value(await sold.publish());
    expect(await billing.hasOffersForSale()).toBe(true);
    expect(
      value(await billing.offers({ mode: "subscription" })).items.map(
        (item) => item.offer.id,
      ),
    ).toEqual([sold.offerId]);
  });

  test("предложение не выдаёт ревью и не открывает отдельный материал", async () => {
    const guide = randomUUID();
    const save = (
      benefits: readonly string[],
      contentScope?: { guideIds: string[]; materialIds: string[] },
    ) =>
      billing.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: randomUUID(),
          name: "Запрещённый состав",
          benefits: [...benefits],
          ...(contentScope === undefined ? {} : { contentScope }),
        },
      });
    // Ревью не выдаёт ни покупка, ни тариф.
    expect(await save([`guide:${guide}`, "reviews"])).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(
      await save(["materials", "reviews"], {
        guideIds: [guide],
        materialIds: [],
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    // Состав называет только продукты: отдельный материал в тариф не входит.
    expect(
      await save(["materials", "community"], {
        guideIds: [guide],
        materialIds: [randomUUID()],
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    // Строка, записанная в обход каталога, с ревью не продаётся.
    const sold = await offer({
      benefits: ["materials"],
      mode: "subscription",
      contentScope: { guideIds: [guide], materialIds: [] },
    });
    value(await sold.publish());
    await database.prisma.billingOffer.update({
      where: { id: sold.offerId },
      data: { benefits: ["materials", "reviews"] },
    });
    expect(
      await billing.quote(randomUUID(), {
        operationId: randomUUID(),
        paymentOptionId: sold.optionId,
        optionRevision: 1,
      }),
    ).toMatchObject({ error: { code: "not_found" } });
  });
});

function pick(command: { accountId: string; purchaseRef: string }) {
  return { accountId: command.accountId, purchaseRef: command.purchaseRef };
}

function required<T>(input: T | undefined): T {
  if (input === undefined) throw new Error("Missing test fixture");
  return input;
}
