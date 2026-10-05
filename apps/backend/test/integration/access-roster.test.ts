import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  BillingOperations,
  BillingPricing,
} from "../../src/modules/billing/index.js";
import type {
  OwnerOutcome,
  OwnerResult,
} from "../../src/modules/billing/domain/owner-operations.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const now = new Date("2030-03-15T12:00:00.000Z");
const at = (value: string) => new Date(value);
const scope = { guideIds: [], materialIds: [], allGuides: true };

function success(result: OwnerResult): OwnerOutcome {
  if (!result.ok) throw new Error(result.error.code);
  return result.result;
}
function failure(result: OwnerResult): string {
  if (result.ok) throw new Error(`Unexpected success ${result.result.outcome}`);
  return result.error.code;
}

describe("раздел «Доступ»: люди и сводка на PostgreSQL (#910)", () => {
  let db: TestDatabase;
  let operations: BillingOperations;
  const owner = randomUUID();
  const outsider = randomUUID();
  const subscription = { id: randomUUID(), name: "Подписка Inside" };
  const course = { id: randomUUID(), name: "Курс" };
  const guide = { id: randomUUID(), name: "Руководство" };
  // Account по возрастанию id: список людей идёт в этом порядке.
  const [paying, gifted, student, manual, buyer, renewing, former, failed] =
    Array.from({ length: 8 }, () => randomUUID()).sort();
  if (
    paying === undefined ||
    gifted === undefined ||
    student === undefined ||
    manual === undefined ||
    buyer === undefined ||
    renewing === undefined ||
    former === undefined ||
    failed === undefined
  )
    throw new Error("accounts");

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [
      owner,
      outsider,
      paying,
      gifted,
      student,
      manual,
      buyer,
      renewing,
      former,
      failed,
    ])
      await db.prisma.account.create({
        data: {
          id,
          logtoIssuer: "https://identity.example.test",
          logtoSubject: id,
        },
      });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "billing:manage" },
    });
    await linkTelegramAccount(db.prisma, {
      accountId: paying,
      identityRef: "tg-paying",
      now,
    });
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-roster-fingerprint-key-000000",
    });
    const grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: new TelegramAccountLinks(db.prisma),
      clock: () => now,
    });
    operations = new BillingOperations({
      prisma: db.prisma,
      accounts,
      pricing: new BillingPricing({
        prisma: db.prisma,
        accounts,
        grants,
        clock: () => now,
        sale: { payments: true, subscriptions: true },
      }),
      payments: { reconcile: () => Promise.reject(new Error("unused")) },
      subscriptions: { cancel: () => Promise.reject(new Error("unused")) },
      grants,
      bank: undefined,
      clock: () => now,
    });

    // Оплата подписки: назначение из платежа кончается через 5 дней, приглашение её открыло.
    await enrollment(paying, subscription, "platform_payment", {
      startsAt: at("2030-02-10T00:00:00.000Z"),
      endsAt: at("2030-03-20T00:00:00.000Z"),
    });
    await invitation({
      offerId: subscription.id,
      mode: "purchase",
      issuedAt: at("2030-02-01T00:00:00.000Z"),
      claimedAt: at("2030-02-08T00:00:00.000Z"),
      claimedAccountId: paying,
      redeemedAt: at("2030-02-09T00:00:00.000Z"),
    });
    // Подписка с автопродлением: конец периода — дата списания, а не окончание доступа.
    await enrollment(renewing, subscription, "platform_payment", {
      startsAt: at("2030-02-17T00:00:00.000Z"),
      endsAt: at("2030-03-17T00:00:00.000Z"),
    });
    await renewingSubscription(renewing);
    // У оплатившего карта отвязана: подписка активна, но не продлится, и доступ кончится.
    await renewingSubscription(paying, { bindingRevoked: true });
    // Подарок по приглашению без срока.
    const gift = await enrollment(gifted, subscription, "invitation", {
      startsAt: at("2030-03-01T00:00:00.000Z"),
      endsAt: null,
    });
    await invitation({
      offerId: subscription.id,
      mode: "gift",
      issuedAt: at("2030-02-20T00:00:00.000Z"),
      claimedAt: at("2030-03-01T00:00:00.000Z"),
      claimedAccountId: gifted,
      redeemedAt: at("2030-03-01T00:00:00.000Z"),
      enrollmentId: gift,
    });
    await enrollment(student, course, "course", {
      startsAt: at("2029-06-01T00:00:00.000Z"),
      endsAt: null,
    });
    // Ручное право без назначения и недавно закончившееся ручное назначение.
    await grant(manual, "manual", "owner-decision", ["community"], {
      validUntil: at("2030-04-30T00:00:00.000Z"),
    });
    await enrollment(manual, subscription, "manual", {
      startsAt: at("2030-01-01T00:00:00.000Z"),
      endsAt: at("2030-03-01T00:00:00.000Z"),
    });
    // Разовая покупка руководства и частичный возврат по ней.
    const guidePurchase = await purchase(buyer, guide, "one_time", {
      amountKopecks: 150_000n,
      confirmedAt: at("2030-03-05T00:00:00.000Z"),
    });
    await grant(buyer, "paid", `${guidePurchase}:materials`, ["materials"], {
      validUntil: null,
    });
    await refund(buyer, guidePurchase, 50_000n, at("2030-03-10T00:00:00.000Z"));
    // Назначение Tribute кончилось больше 30 дней назад: в списке его нет.
    await enrollment(former, subscription, "tribute", {
      startsAt: at("2029-09-01T00:00:00.000Z"),
      endsAt: at("2029-12-01T00:00:00.000Z"),
      endPolicy: "confirmed_external",
    });
    // Оплаты подписки: в феврале, в ночь на 1 марта по Москве и больше 12 месяцев назад.
    await purchase(paying, subscription, "initial", {
      amountKopecks: 99_000n,
      confirmedAt: at("2030-02-10T00:00:00.000Z"),
    });
    await purchase(paying, subscription, "initial", {
      amountKopecks: 49_000n,
      confirmedAt: at("2030-02-28T22:00:00.000Z"),
    });
    await purchase(paying, subscription, "initial", {
      amountKopecks: 10_000n,
      confirmedAt: at("2029-03-31T20:00:00.000Z"),
    });
    // Приглашения в остальных состояниях.
    await invitation({
      offerId: subscription.id,
      mode: "purchase",
      issuedAt: at("2030-03-10T00:00:00.000Z"),
    });
    await invitation({
      offerId: subscription.id,
      mode: "purchase",
      issuedAt: at("2030-03-10T00:00:00.000Z"),
      claimedAt: at("2030-03-11T00:00:00.000Z"),
    });
    await invitation({
      offerId: subscription.id,
      mode: "gift",
      issuedAt: at("2030-01-01T00:00:00.000Z"),
    });
    await invitation({
      offerId: subscription.id,
      mode: "purchase",
      issuedAt: at("2030-03-01T00:00:00.000Z"),
      revokedAt: at("2030-03-02T00:00:00.000Z"),
    });
    await notice(failed, at("2030-03-14T09:00:00.000Z"));
    await notice(failed, at("2030-02-01T09:00:00.000Z"));
  });
  afterAll(async () => {
    await db.dispose();
  });

  async function enrollment(
    accountId: string,
    offer: { id: string; name: string },
    origin: string,
    terms: {
      startsAt: Date;
      endsAt: Date | null;
      endPolicy?: string;
    },
  ) {
    const id = randomUUID();
    await db.prisma.subscriptionEnrollment.create({
      data: {
        id,
        accountId,
        tierId: offer.id,
        tierRevision: 1,
        snapshot: {
          id: offer.id,
          revision: 1,
          name: offer.name,
          benefits: ["community", "materials"],
          contentScope: scope,
        },
        origin,
        sourceRef: randomUUID(),
        startsAt: terms.startsAt,
        endsAt: terms.endsAt,
        endPolicy: terms.endPolicy ?? "fixed",
        billingRef: origin === "platform_payment" ? randomUUID() : null,
        revision: 1,
        reason: "synthetic",
      },
    });
    return id;
  }
  async function renewingSubscription(
    accountId: string,
    options: { bindingRevoked?: boolean } = {},
  ) {
    const id = randomUUID();
    await db.prisma.billingSubscription.create({
      data: {
        id,
        accountId,
        state: "active",
        bindingRef: id,
        bindingCiphertext: "synthetic-binding",
        bindingRevokedAt:
          options.bindingRevoked === true
            ? at("2030-03-01T00:00:00.000Z")
            : null,
        snapshot: snapshot(subscription, 99_000),
        consent: {},
        anchorAt: at("2030-02-17T00:00:00.000Z"),
        anchorMonths: 1,
        periodIndex: 1,
        periodStartsAt: at("2030-02-17T00:00:00.000Z"),
        paidUntil: at("2030-03-17T00:00:00.000Z"),
        periodAmountKopecks: 99_000n,
        revision: 1,
        createdAt: at("2030-02-17T00:00:00.000Z"),
        updatedAt: at("2030-02-17T00:00:00.000Z"),
      },
    });
  }
  async function grant(
    accountId: string,
    source: string,
    sourceRef: string,
    capabilities: string[],
    terms: { validUntil: Date | null },
  ) {
    await db.prisma.accessGrant.create({
      data: {
        id: randomUUID(),
        accountId,
        source,
        sourceRef,
        capabilities,
        startsAt: at("2030-03-01T00:00:00.000Z"),
        validUntil: terms.validUntil,
        revision: 1,
        reason: "synthetic",
      },
    });
  }
  function snapshot(offer: { id: string; name: string }, price: number) {
    return {
      offer: {
        id: offer.id,
        revision: 1,
        name: offer.name,
        benefits: ["materials"],
        archived: false,
      },
      paymentOption: {
        id: randomUUID(),
        revision: 1,
        offerId: offer.id,
        months: 1,
        priceKopecks: price,
        archived: false,
      },
      promotion: null,
      currency: "RUB",
      timezone: "Europe/Moscow",
      firstPriceKopecks: price,
      renewalPriceKopecks: price,
    };
  }
  async function purchase(
    accountId: string,
    offer: { id: string; name: string },
    kind: "one_time" | "initial",
    payment: { amountKopecks: bigint; confirmedAt: Date },
  ) {
    const value = snapshot(offer, Number(payment.amountKopecks));
    const quoteRef = randomUUID();
    await db.prisma.billingPriceQuote.create({
      data: {
        id: quoteRef,
        accountId,
        operationId: randomUUID(),
        fingerprint: quoteRef,
        snapshot: value,
        createdAt: payment.confirmedAt,
        expiresAt: new Date(payment.confirmedAt.getTime() + 3_600_000),
      },
    });
    const id = randomUUID();
    await db.prisma.billingPurchase.create({
      data: {
        id,
        accountId,
        quoteRef,
        kind,
        lifecycleActive: false,
        state: "confirmed",
        environment: "test",
        terminalRef: "terminal",
        paymentId: randomUUID(),
        amountKopecks: payment.amountKopecks,
        snapshot: value,
        acceptance: {},
        contact: {},
        fiscalization: "pending",
        confirmedAt: payment.confirmedAt,
        // Подтверждённая оплата подписки называет конец оплаченного периода.
        periodEndsAt:
          kind === "one_time"
            ? null
            : new Date(payment.confirmedAt.getTime() + 30 * 86_400_000),
        createdAt: payment.confirmedAt,
        updatedAt: payment.confirmedAt,
      },
    });
    return id;
  }
  async function refund(
    accountId: string,
    purchaseRef: string,
    amountKopecks: bigint,
    confirmedAt: Date,
  ) {
    const decisionRef = randomUUID();
    await db.prisma.billingRefundDecision.create({
      data: {
        id: decisionRef,
        purchaseRef,
        accountId,
        actorId: owner,
        operationId: randomUUID(),
        amountKopecks,
        basis: "compensation",
        access: "keep",
        recurring: "keep",
        reason: "synthetic",
        state: "executed",
        revision: 2,
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
      },
    });
    await db.prisma.billingRefund.create({
      data: {
        id: randomUUID(),
        decisionRef,
        purchaseRef,
        environment: "test",
        terminalRef: "terminal",
        paymentId: randomUUID(),
        amountKopecks,
        state: "confirmed",
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
      },
    });
  }
  async function invitation(input: {
    offerId: string;
    mode: "purchase" | "gift";
    issuedAt: Date;
    claimedAt?: Date;
    claimedAccountId?: string;
    redeemedAt?: Date;
    revokedAt?: Date;
    enrollmentId?: string;
  }) {
    await db.prisma.invitation.create({
      data: {
        id: randomUUID(),
        code: randomUUID().replaceAll("-", ""),
        offerId: input.offerId,
        offerRevision: 1,
        mode: input.mode,
        giftMonths: null,
        issuedBy: owner,
        issuedAt: input.issuedAt,
        expiresAt: new Date(input.issuedAt.getTime() + 14 * 86_400_000),
        claimedAt: input.claimedAt ?? null,
        claimedIdentityRef: input.claimedAt === undefined ? null : "tg-any",
        claimedAccountId: input.claimedAccountId ?? null,
        redeemedAt: input.redeemedAt ?? null,
        revokedAt: input.revokedAt ?? null,
        enrollmentId: input.enrollmentId ?? null,
        revision: 1,
      },
    });
  }
  async function notice(accountId: string, occurredAt: Date) {
    await db.prisma.billingNotice.create({
      data: {
        id: randomUUID(),
        accountId,
        kind: "payment_failed",
        sourceRef: randomUUID(),
        revision: 1,
        state: "current",
        occurredAt,
        notAfter: new Date(occurredAt.getTime() + 86_400_000),
        title: subscription.name,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    });
  }
  async function people(filters: object = {}) {
    const outcome = success(
      await operations.execute(owner, {
        operation: "people.list",
        operationId: randomUUID(),
        ...filters,
      }),
    );
    if (outcome.outcome !== "people") throw new Error(outcome.outcome);
    return outcome;
  }
  async function accountsOf(filters: object) {
    return (await people(filters)).items.map((item) => item.accountId);
  }

  test("список людей показывает все источники, Telegram и недавно закончившееся", async () => {
    const page = await people();
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.accountId)).toEqual([
      paying,
      gifted,
      student,
      manual,
      buyer,
      renewing,
    ]);
    const byAccount = new Map(page.items.map((item) => [item.accountId, item]));
    expect(byAccount.get(paying)).toMatchObject({
      telegramIdentityRef: "tg-paying",
      grounds: [
        {
          kind: "enrollment",
          source: "platform_payment",
          offer: subscription,
          state: "active",
          endsAt: "2030-03-20T00:00:00.000Z",
        },
      ],
    });
    expect(byAccount.get(gifted)?.telegramIdentityRef).toBeNull();
    expect(byAccount.get(gifted)?.grounds).toMatchObject([
      { source: "invitation", offer: subscription, endsAt: null },
    ]);
    expect(byAccount.get(student)?.grounds).toMatchObject([
      { source: "course", offer: course, state: "active" },
    ]);
    expect(byAccount.get(manual)?.grounds).toMatchObject([
      { kind: "enrollment", source: "manual", state: "ended" },
      {
        kind: "grant",
        source: "manual",
        offer: null,
        capabilities: ["community"],
        state: "active",
      },
    ]);
    expect(byAccount.get(buyer)?.grounds).toMatchObject([
      {
        kind: "grant",
        source: "one_time_purchase",
        offer: guide,
        endPolicy: null,
        state: "active",
      },
    ]);
  });

  test("фильтры Offer, источника и состояния сочетаются", async () => {
    expect(await accountsOf({ source: "invitation" })).toEqual([gifted]);
    expect(await accountsOf({ source: "one_time_purchase" })).toEqual([buyer]);
    expect(await accountsOf({ source: "manual" })).toEqual([manual]);
    expect(await accountsOf({ source: "tribute" })).toEqual([]);
    expect(await accountsOf({ state: "expiring" })).toEqual([paying, renewing]);
    expect(await accountsOf({ state: "ended" })).toEqual([manual]);
    expect(await accountsOf({ offerId: guide.id })).toEqual([buyer]);
    expect(await accountsOf({ offerId: subscription.id })).toEqual([
      paying,
      gifted,
      manual,
      renewing,
    ]);
    expect(
      await accountsOf({ offerId: subscription.id, state: "active" }),
    ).toEqual([paying, gifted, renewing]);
    // Все основания человека остаются в ответе, даже если фильтр прошло одно.
    const [manualOnly] = (await people({ state: "active", source: "manual" }))
      .items;
    expect(manualOnly?.grounds).toHaveLength(2);
  });

  test("страницы идут по курсору без пропусков и повторов", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await people({
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      seen.push(...page.items.map((item) => item.accountId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([paying, gifted, student, manual, buyer, renewing]);
  });

  test("чтение требует billing:manage и границ страницы", async () => {
    expect(
      failure(
        await operations.execute(outsider, {
          operation: "people.list",
          operationId: randomUUID(),
        }),
      ),
    ).toBe("forbidden");
    expect(
      failure(
        await operations.execute(outsider, {
          operation: "access.summary",
          operationId: randomUUID(),
        }),
      ),
    ).toBe("forbidden");
    expect(
      failure(
        await operations.execute(owner, {
          operation: "people.list",
          operationId: randomUUID(),
          limit: 101,
        }),
      ),
    ).toBe("invalid_request");
    expect(
      failure(
        await operations.execute(owner, {
          operation: "people.list",
          operationId: randomUUID(),
          source: "tribute_period",
        }),
      ),
    ).toBe("invalid_request");
    // Чтение не пишет журнал владельческих команд.
    expect(await db.prisma.billingOwnerCommand.count()).toBe(0);
  });

  test("сводка сходится с основаниями, приглашениями, платежами и возвратами", async () => {
    const outcome = success(
      await operations.execute(owner, {
        operation: "access.summary",
        operationId: randomUUID(),
      }),
    );
    if (outcome.outcome !== "accessSummary") throw new Error(outcome.outcome);
    expect(outcome.value).toEqual({
      asOf: now.toISOString(),
      active: [
        { offerId: course.id, name: course.name, paid: 0, gift: 0, course: 1 },
        {
          offerId: subscription.id,
          name: subscription.name,
          paid: 2,
          gift: 1,
          course: 0,
        },
        { offerId: guide.id, name: guide.name, paid: 1, gift: 0, course: 0 },
      ],
      invitations: {
        issued: 6,
        opened: 3,
        purchaseOpened: 1,
        paid: 1,
        gifted: 1,
        expired: 1,
        revoked: 1,
      },
      attention: [
        {
          accountId: failed,
          reason: "payment_failed",
          source: "platform_payment",
          offerId: null,
          title: subscription.name,
          at: "2030-03-14T09:00:00.000Z",
        },
        {
          accountId: paying,
          reason: "ending",
          source: "platform_payment",
          offerId: subscription.id,
          title: subscription.name,
          at: "2030-03-20T00:00:00.000Z",
        },
      ],
      revenue: [
        {
          month: "2030-03",
          offerId: subscription.id,
          name: subscription.name,
          payments: 1,
          revenueKopecks: 49_000,
          refunds: 0,
          refundedKopecks: 0,
        },
        {
          month: "2030-03",
          offerId: guide.id,
          name: guide.name,
          payments: 1,
          revenueKopecks: 150_000,
          refunds: 1,
          refundedKopecks: 50_000,
        },
        {
          month: "2030-02",
          offerId: subscription.id,
          name: subscription.name,
          payments: 1,
          revenueKopecks: 99_000,
          refunds: 0,
          refundedKopecks: 0,
        },
      ],
    });
  });
});
