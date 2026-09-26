import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { BillingPricing } from "../../src/modules/billing/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const allMethods = {
  recurringCardConfirmed: false,
  cardOnlyHostedConfirmed: false,
};
const cardOnly = {
  recurringCardConfirmed: true,
  cardOnlyHostedConfirmed: true,
};
const contact = {
  encryptionKey: Buffer.alloc(32, 7).toString("base64"),
  smtpHost: "127.0.0.1",
  smtpPort: 587,
  from: "inside@example.test",
  localInsecure: true,
};
type Terminal = typeof allMethods;

/**
 * Процесс, который продаёт или сверяет оплату, не стартует молча без неё: включённая в каталоге
 * продажа требует терминал и адрес отправки чеков, а продажа подписки — ещё и оба подтверждения.
 * Проверка читает весь каталог, поэтому у каждого случая своя база; она создаётся в хуке, чтобы
 * миграции не входили во время самой проверки.
 */
describe("sale configuration at process start (real PostgreSQL)", () => {
  let db: TestDatabase;
  let pricing: BillingPricing;
  let owner: string;

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    owner = randomUUID();
    await db.prisma.account.create({
      data: {
        id: owner,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: owner,
      },
    });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    // Каталог заводит процесс со всеми правами продажи: проверяется состояние, а не отказ каталога.
    pricing = new BillingPricing({
      prisma: db.prisma,
      sale: { payments: true, subscriptions: true },
      accounts: assembleAccounts({
        prisma: db.prisma,
        emailFingerprintKey: "sale-configuration-test-key-000000000",
      }),
    });
  });
  afterEach(async () => db.dispose());

  async function offer(
    mode: "subscription" | "one_time",
    options: { publish?: boolean; archiveOption?: boolean } = {},
  ) {
    const offerId = randomUUID(),
      optionId = randomUUID(),
      capability = `guide:${randomUUID()}`;
    value(
      await pricing.manage(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value:
          mode === "one_time"
            ? {
                id: offerId,
                name: "Руководство",
                benefits: [capability, "support"],
                benefitPeriods: [
                  { capability, months: null },
                  { capability: "support", months: 6 },
                ],
              }
            : {
                id: offerId,
                name: "Материалы",
                benefits: ["materials"],
                contentScope: { guideIds: [randomUUID()], materialIds: [] },
              },
      }),
    );
    value(
      await pricing.manage(owner, {
        operation: "paymentOptions.save",
        operationId: randomUUID(),
        value: {
          id: optionId,
          offerId,
          mode,
          months: 1,
          priceKopecks: 100_000,
        },
      }),
    );
    if (options.archiveOption)
      value(
        await pricing.manage(owner, {
          operation: "paymentOptions.archive",
          operationId: randomUUID(),
          expectedRevision: 1,
          id: optionId,
        }),
      );
    if (options.publish ?? true)
      value(
        await pricing.manage(owner, {
          operation: "offers.publish",
          operationId: randomUUID(),
          expectedRevision: 1,
          id: offerId,
        }),
      );
  }
  const check = (tbank?: Terminal, billingContact?: typeof contact) =>
    pricing.assertSaleConfigured({ tbank, billingContact });

  test("nothing on sale starts without payment configuration; a published offer without a live option sells nothing", async () => {
    await expect(check()).resolves.toBeUndefined();
    await offer("subscription", { publish: false });
    await offer("one_time", { archiveOption: true });
    await expect(check()).resolves.toBeUndefined();
  });

  test("one-time sale needs the terminal and receipt contact but not the card-only confirmations", async () => {
    await offer("one_time");
    await expect(check()).rejects.toThrow(
      "Sale is enabled in the billing catalog, but TBANK_CONFIG_JSON is not configured",
    );
    await expect(check(allMethods)).rejects.toThrow(
      "Sale is enabled in the billing catalog, but BILLING_CONTACT_* is not configured",
    );
    await expect(check(allMethods, contact)).resolves.toBeUndefined();
  });

  test("subscription sale on a terminal without both confirmations refuses to start", async () => {
    await offer("subscription");
    await expect(check(allMethods, contact)).rejects.toThrow(
      "Subscription sale is enabled in the billing catalog, but the terminal does not confirm recurringCardConfirmed and cardOnlyHostedConfirmed",
    );
    await expect(
      check({ ...cardOnly, cardOnlyHostedConfirmed: false }, contact),
    ).rejects.toThrow("Subscription sale");
    await expect(check(cardOnly, contact)).resolves.toBeUndefined();
  });
});
