import { ProductDiscovery } from "../../src/modules/products/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";

import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assembleAccounts,
  BillingContact,
  NotificationAccounts,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  assembleBillingNotificationOutbox,
  BillingNotices,
  BillingPayments,
  type BillingPricing,
} from "../../src/modules/billing/index.js";
import {
  Notifications,
  type SendNotificationEmail,
} from "../../src/modules/notifications/index.js";

import { deliverySchema } from "../../src/modules/notifications/domain/notification-wire.js";

import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { BankFixture } from "./setup/bank.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  pressedPaymentButton,
  syntheticConsentDocuments,
  type RenewalSource,
} from "./setup/consent-documents.js";

import { hasText } from "../../src/infrastructure/contracts/text.js";

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const origin = "https://inside.example.test";
const config = syntheticTbankConfig({
  environment: "demo",
  terminalKey: "SYNTHETICNOTICES",
  password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 61).toString("base64"),
  minimumKopecks: 100,
  maximumKopecks: 10_000_000,
  returnUrl: `${origin}/payment/return`,
  notificationUrl: `${origin}/billing/tbank/notification`,
  receipt: { taxation: "usn_income", tax: "none" },
});
const documents = syntheticConsentDocuments
  .filter((document) => document.kind === "terms")
  .map((document) => ({
    ...document,
    commercialModel: "product-lifetime-v1" as const,
  }));

/**
 * Оба конца одного пути на реальном PostgreSQL: подтверждённые факты Billing становятся поводами,
 * общий Notifications раскрывает аудиторию и доставляет их. Банк, SMTP и Telegram синтетические,
 * брокер заменён прямой передачей конвертов — сам транспорт проверяется отдельным broker-тестом.
 */
describe("служебные сообщения подписки (реальные PostgreSQL и фасеты; синтетические банк и каналы)", () => {
  let db: TestDatabase;
  let now = new Date("2030-01-31T10:00:00Z");
  let owner: string;
  let pricing: BillingPricing;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let accounts: ReturnType<typeof assembleAccounts>;
  let contact: BillingContact;
  const protection = billingContactProtection(
    Buffer.alloc(32, 62).toString("base64"),
  );
  const codes = new Map<string, string>();

  beforeAll(async () => {
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
    accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-notice-fingerprint-000000",
    });
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      clock: () => now,
    });
    pricing = assembleTestBillingPricing({
      prisma: db.prisma,
      accounts,
      clock: () => now,
      sale: { payments: true },
    });
    contact = new BillingContact({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-notice-fingerprint-000000",
      protection,
      documents,
      now: () => now,
      sendCode: (message) => {
        codes.set(message.challengeRef, message.code);
        return Promise.resolve();
      },
    });
  });
  afterAll(async () => db.dispose());

  async function scenario(options: { readonly telegram?: boolean } = {}) {
    now = new Date("2030-01-31T10:00:00Z");
    for (const stale of await db.prisma.billingSubscription.findMany({
      where: { state: { not: "ended" } },
    }))
      await db.prisma.billingSubscription.update({
        where: { id: stale.id },
        data: { state: "ended", revision: stale.revision + 1, updatedAt: now },
      });
    await db.prisma.billingPurchase.updateMany({
      where: { kind: "initial", lifecycleActive: true },
      data: { lifecycleActive: false },
    });
    const buyer = randomUUID();
    await db.prisma.account.create({
      data: {
        id: buyer,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: buyer,
        createdAt: new Date(now.getTime() - 60_000),
      },
    });
    const start = await contact.start(buyer, {
      operationId: randomUUID(),
      email: `${buyer}@example.test`,
      expectedRevision: 0,
    });
    if (!start.ok) throw new Error(start.error.code);
    expect(
      await contact.confirm(buyer, {
        operationId: randomUUID(),
        challengeRef: start.challengeRef,
        code: codes.get(start.challengeRef),
      }),
    ).toMatchObject({ ok: true });
    if (options.telegram === true)
      await db.prisma.telegramAccountLinkState.create({
        data: {
          accountId: buyer,
          linkRef: randomUUID(),
          revision: 1,
          principalRef: `principal-${buyer}`,
          identityRef: `identity-${buyer}`,
          updatedAt: now,
        },
      });

    const productId = randomUUID();
    await db.prisma.product.create({
      data: { id: productId, slug: productId, name: "Материалы" },
    });
    value(
      await pricing.manage(owner, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        value: {
          productId,
          name: "Материалы",
          priceKopecks: 100_000,
          published: true,
        },
      }),
    );

    const bank = new BankFixture(config);
    const client = bank.client();
    const payments = new BillingPayments({
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      sale: { payments: true },
      prisma: db.prisma,
      bank: client,
      contact,
      grants,
      clock: () => now,
    });
    const notices = new BillingNotices({
      prisma: db.prisma,
      clock: () => now,
    });
    const contacts = new NotificationAccounts(db.prisma, protection);
    const links = new TelegramAccountLinks(db.prisma);
    // Та же композиция, что и в NotificationsModule: источник подписки — публичный фасет Billing.
    const notifications = new Notifications(
      {
        prisma: db.prisma,
        now: () => now,
        origin,
        sources: {
          resolve: (event) =>
            event.eventType === "billing.notice-ready"
              ? notices.resolveNotice(event)
              : Promise.resolve({ status: "unavailable" }),
          canRead: () => Promise.resolve("denied"),
        },
        recipients: {
          exists: (id) => contacts.exists(id),
          enumerate: (query) => contacts.enumerate(query),
          email: (binding) => contacts.email(binding),
          binding: async (account, channel) => {
            if (channel === "email") return contacts.binding(account);
            const result = await links.readBinding({ accountId: account });
            if (!result.ok) throw new Error("notification_binding_unavailable");
            return hasText(result.binding?.telegramIdentityRef) &&
              hasText(result.binding.accountRef)
              ? {
                  channel: "telegram",
                  ...result.binding,
                  accountRef: result.binding.accountRef,
                  telegramIdentityRef: result.binding.telegramIdentityRef,
                }
              : null;
          },
        },
      },
      accounts,
    );
    const relay = assembleBillingNotificationOutbox(db.prisma);
    const telegramCommands: unknown[] = [];
    const sent: { subject: string; text: string; email: string }[] = [];
    const deliverEmail: SendNotificationEmail = (message) => {
      sent.push(message);
      return Promise.resolve({ state: "sent" });
    };

    /** Сколько собственных событий покупателя ещё ждут раскрытия: sweep берёт по одному. */
    async function pendingEvents() {
      const events = await db.prisma.billingNoticeRevision.findMany({
        where: { notice: { accountId: buyer } },
        select: { messageId: true },
      });
      return db.prisma.notificationInbox.count({
        where: {
          messageId: { in: events.map((row) => row.messageId) },
          completedAt: null,
        },
      });
    }
    /**
     * Пробег общего пути вместо брокера: outbox источника, раскрытие аудитории, доставка и
     * проекция результата. Заканчивается на факте: собственных нераскрытых событий не осталось
     * и очередной пробег ничего не перенёс.
     */
    async function pump(send?: SendNotificationEmail) {
      for (let pass = 0; pass < 24; pass += 1) {
        let moved = false;
        while (
          await relay.relay("billing", (envelope) =>
            notifications.acceptEvent(envelope).then(() => undefined),
          )
        )
          moved = true;
        await notifications.sweep(send);
        for (const lane of [
          "telegramSubscription",
          "emailSubscription",
          "emailResult",
        ] as const)
          while (
            await notifications.transport.outbox.relay(lane, (envelope) => {
              if (lane === "telegramSubscription") {
                telegramCommands.push(JSON.parse(envelope.payload));
                return Promise.resolve();
              }
              return notifications.acceptEvent(envelope).then(() => undefined);
            })
          )
            moved = true;
        if (!moved && (await pendingEvents()) === 0) return;
      }
      throw new Error("Путь сообщений не сошёлся");
    }
    /** Готовит команды всех принятых событий, но не отправляет. */
    async function prepare() {
      while (
        await relay.relay("billing", (envelope) =>
          notifications.acceptEvent(envelope).then(() => undefined),
        )
      ) {
        /* durable events */
      }
      for (let pass = 0; pass < 24; pass += 1) {
        if ((await pendingEvents()) === 0) return;
        await notifications.sweep();
      }
      throw new Error("Аудитория не раскрыта");
    }
    /** Подготовленная команда своего покупателя по назначению сообщения. */
    async function commandFor(kind: string) {
      const rows = await db.prisma.notificationCommand.findMany({
        where: { delivery: { notification: { accountId: buyer } } },
        orderBy: { revision: "asc" },
      });
      const found = rows
        .map((row) => ({
          row,
          command: deliverySchema.parse(JSON.parse(row.payload)),
        }))
        .find((entry) => entry.command.content.kind === kind);
      if (!found) throw new Error(`Нет подготовленной команды ${kind}`);
      return found;
    }
    async function consentFor(
      contextRef: string,
      renewal: RenewalSource,
      screen: "checkout" | "subscription-resume" = "checkout",
    ) {
      const accepted = await contact.acceptConsents(
        buyer,
        pressedPaymentButton(
          {
            operationId: randomUUID(),
            contextRef,
            documents: documents.map((document) => ({
              kind: document.kind,
              documentId: document.documentId,
              version: document.version,
              digest: document.digest,
              accepted: true,
            })),
          },
          renewal,
          screen,
        ),
      );
      if (!accepted.ok) throw new Error(accepted.error.code);
      return accepted.evidenceRefs;
    }
    async function buy() {
      const quote = value(
        await pricing.quote(buyer, {
          operationId: randomUUID(),
          productId,
          priceRevision: 1,
        }),
      );
      const purchase = value(
        await payments.purchase(buyer, {
          operationId: randomUUID(),
          quoteRef: quote.quoteRef,
          contactRevision: 1,
          consentEvidenceRefs: await consentFor(quote.quoteRef, {
            snapshot: quote.snapshot,
          }),
          acknowledgeExistingAccess: false,
        }),
      );
      expect(
        await payments.notification(
          bank.notify(purchase.purchaseRef, "AUTHORIZED", {
            RebillId: "synthetic-card",
          }),
        ),
      ).toMatchObject({ ok: true });
      expect(
        await payments.notification(
          bank.notify(purchase.purchaseRef, "CONFIRMED"),
        ),
      ).toMatchObject({ ok: true });
      value(await payments.recover());
      return purchase.purchaseRef;
    }
    const noticesOf = (kind: string) =>
      db.prisma.billingNotice.findMany({
        where: { accountId: buyer, kind },
        orderBy: { occurredAt: "asc" },
      });
    const at = (instant: string) => {
      now = new Date(instant);
    };
    // База общая для файла, поэтому каждый барьер читает строки только своего покупателя.
    const own = { notification: { accountId: buyer } } as const;
    const delivery = (channel: "email" | "telegram") =>
      db.prisma.notificationDelivery.findFirstOrThrow({
        where: { ...own, channel },
      });
    const staged = async () => {
      const revisions = await db.prisma.billingNoticeRevision.findMany({
        where: { notice: { accountId: buyer } },
        select: { messageId: true },
      });
      return db.prisma.billingNotificationOutbox.count({
        where: { messageId: { in: revisions.map((row) => row.messageId) } },
      });
    };
    return {
      buyer,
      bank,
      payments,
      notices,
      notifications,
      buy,
      noticesOf,
      pump,
      sent,
      telegramCommands,
      deliverEmail,
      at,
      own,
      delivery,
      staged,
      prepare,
      commandFor,
    };
  }

  test("подтверждённая оплата даёт один повод и одно письмо; повтор банка не создаёт второй", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    expect(await s.noticesOf("payment_succeeded")).toMatchObject([
      {
        state: "current",
        revision: 1,
        amountKopecks: 100_000n,
        title: "Материалы",
      },
    ]);
    // Дедупликация повода не зависит от идемпотентности платежа: повтор того же уведомления банка
    // проходит своим путём и не создаёт второго обещания сообщения.
    expect(
      await s.payments.notification(s.bank.notify(purchaseRef, "CONFIRMED")),
    ).toMatchObject({ ok: true });
    expect(await s.noticesOf("payment_succeeded")).toHaveLength(1);
    expect(await s.staged()).toBe(1);

    await s.pump(s.deliverEmail);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({
      subject: "Оплата Inside подтверждена",
      email: `${s.buyer}@example.test`,
    });
    expect(s.sent[0]?.text).toContain("Материалы");
    expect(s.sent[0]?.text).toContain("Сумма: 1000.00 ₽.");
    expect(s.sent[0]?.text).toContain(
      `${origin}/payment/return?purchaseRef=${purchaseRef}`,
    );
    expect(
      await db.prisma.notificationDelivery.count({
        where: { ...s.own, state: "sent" },
      }),
    ).toBe(1);
    // Повторный пробег ничего не отправляет заново и не создаёт вторую Notification.
    await s.pump(s.deliverEmail);
    expect(s.sent).toHaveLength(1);
    expect(
      await db.prisma.notification.count({ where: { accountId: s.buyer } }),
    ).toBe(1);
    expect(await s.notices.readNotices(s.buyer)).toMatchObject([
      { kind: "payment_succeeded", state: "current", amountKopecks: 100_000 },
    ]);
  });

  test("служебное сообщение идёт в оба канала и не требует согласия на новые материалы", async () => {
    const s = await scenario({ telegram: true });
    await s.buy();
    // Настройки новых материалов выключены по умолчанию и служебного сообщения не касаются.
    expect(await s.notifications.readPreferences(s.buyer)).toEqual({
      revision: 0,
      email: false,
      telegram: false,
    });
    await s.pump(s.deliverEmail);
    expect(s.sent).toHaveLength(1);
    expect(s.telegramCommands).toHaveLength(1);
    expect(s.telegramCommands[0]).toMatchObject({
      content: { category: "subscription", kind: "payment_succeeded" },
      binding: {
        channel: "telegram",
        telegramIdentityRef: `identity-${s.buyer}`,
      },
    });
    const deliveries = await s.notifications.readDeliveries(s.buyer);
    expect(deliveries.map((row) => row.channel).sort()).toEqual([
      "email",
      "telegram",
    ]);
    // Одна Notification и независимые доставки: у каналов общий повод и разные результаты.
    expect(new Set(deliveries.map((row) => row.notificationId)).size).toBe(1);
    expect(deliveries.find((row) => row.channel === "email")).toMatchObject({
      state: "sent",
    });
    expect(deliveries.find((row) => row.channel === "telegram")).toMatchObject({
      state: "accepted",
    });
  });

  test("сбой канала не откатывает оплату и права, а неизвестный исход не повторяется сам", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    let attempts = 0;
    await s.pump(() => {
      attempts += 1;
      return Promise.reject(new Error("lost SMTP response"));
    });
    expect(attempts).toBe(1);
    expect(await s.delivery("email")).toMatchObject({ state: "unknown" });
    expect(
      await db.prisma.billingPurchase.findUniqueOrThrow({
        where: { id: purchaseRef },
      }),
    ).toMatchObject({ state: "confirmed" });
    expect(
      await db.prisma.productAccess.count({ where: { accountId: s.buyer } }),
    ).toBe(1);
    await s.pump(s.deliverEmail);
    expect(attempts).toBe(1);
    expect(s.sent).toHaveLength(0);
  });

  // ------------------------------------------------------------- неоплаченный доступ (#909)

  /** Историческое конечное назначение: новые назначения с #1064 бессрочные. */

  /** Тариф подписки: Offer её принятых условий, на который выдаётся и Enrollment. */
});
