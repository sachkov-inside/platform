import { prepareInvitedQuote } from "./setup/purchase-invitation.js";
import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { guideCapability } from "@inside/access-capabilities";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import {
  BillingOperations,
  type BillingPricing,
} from "../../src/modules/billing/index.js";
import type {
  OwnerOutcome,
  OwnerResult,
} from "../../src/modules/billing/domain/owner-operations.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

/** Только выдуманные ники: настоящий список живёт в production БД и в тесты не попадает. */
const column = [
  "@Synthetic_Alpha",
  "synthetic_beta",
  "t.me/synthetic_gamma",
  "https://t.me/Synthetic_Delta/",
  "  @synthetic_alpha  ",
  "",
  "respondent@example.test",
  "+7 900 000-00-00",
  "Имя Фамилия",
].join("\n");
const limits = { minimumKopecks: 1, maximumKopecks: 10_000_000 };

function success(result: OwnerResult): OwnerOutcome {
  if (!result.ok) throw new Error(result.error.code);
  return result.result;
}
function failure(result: OwnerResult): string {
  if (result.ok) throw new Error(`Unexpected success ${result.result.outcome}`);
  return result.error.code;
}
function asImport(result: OwnerResult) {
  const outcome = success(result);
  if (outcome.outcome !== "respondentImport") throw new Error(outcome.outcome);
  return outcome.value;
}
function asLink(result: OwnerResult) {
  const outcome = success(result);
  if (outcome.outcome !== "respondentLink") throw new Error(outcome.outcome);
  return outcome.value;
}
function asRespondents(result: OwnerResult) {
  const outcome = success(result);
  if (outcome.outcome !== "respondents") throw new Error(outcome.outcome);
  return outcome.value;
}
function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("скидка респондентам анкеты: список ников и личные одноразовые ссылки (#815)", () => {
  let db: TestDatabase;
  let operations: BillingOperations;
  let pricing: BillingPricing;
  const owner = randomUUID();
  const outsider = randomUUID();
  const guideId = randomUUID();
  const now = new Date("2030-03-31T10:00:00Z");

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, outsider])
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
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-survey-fingerprint-key-000000",
    });
    const grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      clock: () => now,
      contentCatalog: {
        list: () =>
          Promise.resolve([
            {
              kind: "guide",
              id: guideId,
              title: "Синтетический курс",
              slug: "synthetic-course",
              available: true,
            },
          ]),
        resolve: () => Promise.resolve([]),
      },
    });
    pricing = assembleTestBillingPricing({
      prisma: db.prisma,
      accounts,
      clock: () => now,
      sale: { payments: true, subscriptions: true },
    });
    operations = new BillingOperations({
      prisma: db.prisma,
      accounts,
      pricing,
      // Выдача ссылок не трогает платежи и подписки.
      payments: { reconcile: () => Promise.reject(new Error("unused")) },
      subscriptions: { cancel: () => Promise.reject(new Error("unused")) },
      grants,
      bank: undefined,
      clock: () => now,
    });
  });
  afterAll(async () => db.dispose());

  /** Разовое предложение курса и архивная акция-шаблон со скидкой на него. */
  async function courseWithTemplate() {
    const offerId = randomUUID();
    const optionId = randomUUID();
    const templateId = randomUUID();
    const manage = (input: object) =>
      pricing.manage(owner, { operationId: randomUUID(), ...input });
    value(
      await manage({
        operation: "offers.save",
        value: {
          id: offerId,
          name: "Курс",
          benefits: [guideCapability(guideId), "support"],
          benefitPeriods: [
            { capability: guideCapability(guideId), months: null },
            { capability: "support", months: 6 },
          ],
        },
      }),
    );
    value(
      await manage({
        operation: "paymentOptions.save",
        value: {
          id: optionId,
          offerId,
          months: 1,
          mode: "one_time",
          priceKopecks: 100_000,
        },
      }),
    );
    value(
      await manage({
        operation: "offers.publish",
        expectedRevision: 1,
        id: offerId,
      }),
    );
    value(
      await manage({
        operation: "promotions.save",
        value: {
          id: templateId,
          name: "Скидка респондентам",
          percent: 30,
          code: null,
          startsAt: "2030-03-01T00:00:00Z",
          endsAt: "2030-05-01T00:00:00Z",
          offerIds: [offerId],
          paymentOptionIds: [],
          usageLimit: null,
        },
      }),
    );
    return { offerId, optionId, templateId };
  }

  test("импорт разбирает колонку анкеты, схлопывает повторы и считает нераспознанное", async () => {
    const first = asImport(
      await operations.execute(owner, {
        operation: "respondents.import",
        operationId: randomUUID(),
        list: column,
      }),
    );
    expect(first).toEqual({
      recognized: 4,
      added: 4,
      unrecognized: 3,
      total: 4,
    });
    // Повторная вставка той же колонки список не меняет.
    expect(
      asImport(
        await operations.execute(owner, {
          operation: "respondents.import",
          operationId: randomUUID(),
          list: `${column}\n@synthetic_epsilon`,
        }),
      ),
    ).toEqual({ recognized: 5, added: 1, unrecognized: 3, total: 5 });
    expect(
      (
        await db.prisma.billingSurveyRespondent.findMany({
          orderBy: { username: "asc" },
        })
      ).map((row) => row.username),
    ).toEqual([
      "synthetic_alpha",
      "synthetic_beta",
      "synthetic_delta",
      "synthetic_epsilon",
      "synthetic_gamma",
    ]);
    expect(
      failure(
        await operations.execute(outsider, {
          operation: "respondents.import",
          operationId: randomUUID(),
          list: "@synthetic_zeta",
        }),
      ),
    ).toBe("forbidden");
  });

  test("ссылка выдаётся нику из списка один раз, одноразовый код даёт скидку одному покупателю", async () => {
    const { optionId, templateId } = await courseWithTemplate();
    const issue = (username: string, template = templateId) =>
      operations.execute(owner, {
        operation: "respondents.issue",
        operationId: randomUUID(),
        username,
        templatePromotionId: template,
      });
    // Действующий шаблон без кода уже продавал бы скидку всем: выдавать по нему нельзя.
    expect(failure(await issue("@synthetic_beta"))).toBe("state_conflict");
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "promotions.archive",
        id: templateId,
        expectedRevision: 1,
      }),
    );
    expect(failure(await issue("@synthetic_unknown"))).toBe("not_found");
    expect(failure(await issue("+7 900 000-00-00"))).toBe("invalid_request");

    const link = asLink(await issue("https://t.me/Synthetic_Beta"));
    expect(link).toMatchObject({ alreadyIssued: false });
    expect(link.guideSlug).toBe("synthetic-course");
    // Сменённая форма ника ведёт к тому же человеку и не создаёт вторую ссылку.
    expect(asLink(await issue("synthetic_beta"))).toEqual({
      ...link,
      alreadyIssued: true,
    });

    const buyer = randomUUID();
    const discounted = value(
      await pricing.quote(
        buyer,
        await prepareInvitedQuote(db.prisma, buyer, {
          operationId: randomUUID(),
          paymentOptionId: optionId,
          optionRevision: 1,
          promoCode: link.code,
        }),
      ),
    );
    expect(discounted.snapshot.firstPriceKopecks).toBe(70_000);
    // Без кода и после архивации шаблона публичной скидки нет.
    expect(
      value(
        await pricing.quote(randomUUID(), {
          operationId: randomUUID(),
          paymentOptionId: optionId,
          optionRevision: 1,
        }),
      ).snapshot.promotion,
    ).toBeNull();
    const purchaseRef = randomUUID();
    value(
      await pricing.reserve({
        accountId: buyer,
        quoteRef: discounted.quoteRef,
        purchaseRef,
        amountLimits: limits,
      }),
    );
    for (const state of ["sent", "confirmed"] as const)
      value(await pricing.settle({ accountId: buyer, purchaseRef, state }));
    // Код одноразовый: второй аккаунт с той же ссылкой получает обычную цену.
    expect(
      value(
        await pricing.quote(randomUUID(), {
          operationId: randomUUID(),
          paymentOptionId: optionId,
          optionRevision: 1,
          promoCode: link.code,
        }),
      ).snapshot.promotion,
    ).toBeNull();

    const status = asRespondents(
      await operations.execute(owner, {
        operation: "respondents.status",
        operationId: randomUUID(),
      }),
    );
    expect(status).toMatchObject({ total: 5, issued: 1, purchased: 1 });
    expect(
      status.respondents.find((row) => row.username === "synthetic_beta"),
    ).toMatchObject({ purchased: true, issuedAt: now.toISOString() });
  });

  test("журнал владельца записывает импорт и выдачу без ников", async () => {
    const journal = await db.prisma.billingOwnerCommand.findMany({
      where: {
        operation: { in: ["respondents.import", "respondents.issue"] },
      },
    });
    expect(journal.map((row) => row.operation).sort()).toEqual([
      "respondents.import",
      "respondents.import",
      "respondents.issue",
      "respondents.issue",
    ]);
    // Чтение и отклонённые команды журнал не пишут; ни одна запись не называет ник.
    expect(
      JSON.stringify(journal.map(({ sequence: _sequence, ...row }) => row)),
    ).not.toMatch(/synthetic_/iu);
  });
});
