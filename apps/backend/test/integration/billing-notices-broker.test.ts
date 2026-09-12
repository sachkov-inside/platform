import { randomUUID } from "node:crypto";
import { GenericContainer, Wait } from "testcontainers";
import { expect, onTestFinished, test } from "vitest";
import { assembleAccounts, BillingContact, NotificationAccounts } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { assembleBillingNotificationOutbox, BillingNotices, BillingPayments, BillingPricing } from "../../src/modules/billing/index.js";
import { assembleMaterialsNotificationOutbox } from "../../src/modules/materials/index.js";
import { Notifications } from "../../src/modules/notifications/index.js";
import { assembleNotificationWorker } from "../../src/infrastructure/notification-transport/worker.js";
import { localNotificationTopology, NOTIFICATION_BROKER_IMAGE } from "../../src/infrastructure/notification-transport/topology.js";
import { lanes } from "../../src/infrastructure/notification-transport/wire.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { BankFixture } from "./setup/bank.js";
import { brokerAdmin, queueDepth } from "./setup/broker.js";
import { distinctClock } from "./setup/distinct-clock.js";
import { eventually } from "./setup/eventually.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { syntheticConsentDocuments } from "./setup/consent-documents.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code); return result.value;
}
// Каждое ожидание заканчивается на зафиксированном факте; бюджет только ограничивает зависший прогон.
const barrierBudgetMs = 30_000;
const origin = "https://inside.example.test";
const config = syntheticTbankConfig({ environment: "demo", terminalKey: "SYNTHETICBROKER", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 63).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  minimumKopecks: 100, maximumKopecks: 10_000_000, returnUrl: `${origin}/account`,
  notificationUrl: `${origin}/billing/tbank/notification`, receipt: { taxation: "usn_income", tax: "none" } });
const documents = syntheticConsentDocuments;

/**
 * Подтверждённая оплата проходит весь путь через настоящий брокер: outbox Billing, очередь
 * событий, раскрытие аудитории общим Notifications, письмо и команда Telegram в своей очереди.
 * Банк и SMTP синтетические; реальные отправки людям здесь не выполняются.
 */
test("подтверждённая оплата доходит до обоих каналов через реальные RabbitMQ и PostgreSQL", async () => {
  const topology = localNotificationTopology("inside-test", 100);
  const broker = await new GenericContainer(NOTIFICATION_BROKER_IMAGE).withExposedPorts(5672).withCopyContentToContainer([
    { content: JSON.stringify(topology), target: "/etc/rabbitmq/definitions.json" },
    { content: "definitions.import_backend = local_filesystem\ndefinitions.local.path = /etc/rabbitmq/definitions.json\n", target: "/etc/rabbitmq/rabbitmq.conf" },
  ]).withWaitStrategy(Wait.forLogMessage(/Server startup complete/)).start();
  onTestFinished(async () => { await broker.stop(); });
  const admin = brokerAdmin(broker);
  const database = await createMigratedTestDatabase();
  onTestFinished(() => database.dispose());
  const url = (principal: string) => `amqp://local-${principal}:inside-local-only@${broker.getHost()}:${broker.getMappedPort(5672)}/inside-test`;
  const urls = { billing: url("billing"), materials: url("materials"), notifications: url("notifications"), email: url("email") };

  const protection = billingContactProtection(Buffer.alloc(32, 64).toString("base64"));
  const codes = new Map<string, string>();
  const owner = randomUUID(), buyer = randomUUID();
  for (const id of [owner, buyer]) await database.prisma.account.create({ data: { id, logtoIssuer: "https://identity.example.test", logtoSubject: id } });
  await database.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
  await database.prisma.telegramAccountLinkState.create({ data: { accountId: buyer, linkRef: randomUUID(), revision: 1,
    principalRef: `principal-${buyer}`, identityRef: `identity-${buyer}`, updatedAt: new Date() } });

  const accounts = assembleAccounts({ prisma: database.prisma, emailFingerprintKey: "synthetic-broker-fingerprint-000000" });
  const grants = assembleAccessGrants({ prisma: database.prisma, accounts });
  const pricing = new BillingPricing({ prisma: database.prisma, accounts });
  const contact = new BillingContact({ prisma: database.prisma, protection, documents, now: () => new Date(),
    sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });
  expect(await grants.classifyLegacy(owner, { operationId: randomUUID(), accountId: buyer, expectedRevision: 0,
    classification: "confirmed_new", sourceRef: buyer, reason: "Synthetic new buyer", bridgeEnabled: false, tributeStopped: false })).toMatchObject({ ok: true });
  const started = await contact.start(buyer, { operationId: randomUUID(), email: "broker-proof@example.test", expectedRevision: 0 });
  if (!started.ok) throw new Error(started.error.code);
  expect(await contact.confirm(buyer, { operationId: randomUUID(), challengeRef: started.challengeRef, code: codes.get(started.challengeRef) })).toMatchObject({ ok: true });

  const offerId = randomUUID(), optionId = randomUUID();
  value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: { id: offerId, name: "Материалы + сопровождение", benefits: ["materials", "support"] } }));
  value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", value: { id: optionId, offerId, months: 1, priceKopecks: 350_000 } }));
  value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));

  const bank = new BankFixture(config);
  const payments = new BillingPayments({ prisma: database.prisma, bank: bank.client(), contact, grants });
  const notices = new BillingNotices({ prisma: database.prisma });
  const contacts = new NotificationAccounts(database.prisma, protection);
  const links = new TelegramAccountLinks(database.prisma);
  // Команда доставки, собранная из двух чтений часов, живёт дольше, чем принимает её потребитель.
  const now = distinctClock();
  const application = new Notifications({
    prisma: database.prisma, origin, now,
    sources: {
      resolve: event => event.eventType === "billing.notice-ready" ? notices.resolveNotice(event) : Promise.resolve({ status: "unavailable" }),
      canRead: () => Promise.resolve("denied"),
    },
    recipients: {
      exists: id => contacts.exists(id), enumerate: query => contacts.enumerate(query), email: binding => contacts.email(binding),
      binding: async (account, channel) => {
        if (channel === "email") return contacts.binding(account);
        const link = await links.readBinding({ accountId: account });
        if (!link.ok) throw new Error("notification_binding_unavailable");
        return link.binding?.telegramIdentityRef && link.binding.accountRef
          ? { channel: "telegram", ...link.binding, accountRef: link.binding.accountRef, telegramIdentityRef: link.binding.telegramIdentityRef } : null;
      },
    },
  }, accounts);

  const sent: { subject: string; text: string; email: string }[] = [];
  const worker = assembleNotificationWorker({ config: { urls, prefetch: 2, quarantineCapacity: 100 }, transport: application.transport,
    billing: assembleBillingNotificationOutbox(database.prisma), materials: assembleMaterialsNotificationOutbox(database.prisma),
    processInbox: () => application.sweep(message => { sent.push(message); return Promise.resolve({ state: "sent" }); }),
    report: () => undefined });

  const quote = value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
  const accepted = await contact.acceptConsents(buyer, { operationId: randomUUID(), contextRef: quote.quoteRef,
    documents: documents.map(document => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
  if (!accepted.ok) throw new Error(accepted.error.code);
  const purchase = value(await payments.purchase(buyer, { operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1,
    consentEvidenceRefs: accepted.evidenceRefs, acknowledgeExistingAccess: false }));
  expect(await payments.notification(bank.notify(purchase.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });

  await worker.start();
  try {
    await eventually(async () => {
      expect(await database.prisma.notificationQuarantine.findMany({ select: { lane: true, reason: true } })).toEqual([]);
      expect(await database.prisma.notificationEmailEffect.count({ where: { state: "sent" } })).toBe(1);
    }, barrierBudgetMs);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ subject: "Оплата Inside подтверждена", email: "broker-proof@example.test" });
    expect(sent[0]?.text).toContain("Материалы + сопровождение");
    expect(sent[0]?.text).toContain("Сумма: 3500.00 ₽.");
    // Событие покинуло outbox Billing только после подтверждения брокера, а команда Telegram
    // ждёт своего приложения в собственной очереди.
    await eventually(async () => {
      expect(await database.prisma.billingNotificationOutbox.count({ where: { publishedAt: null } })).toBe(0);
      expect(await queueDepth(admin, "inside-test", lanes.telegramSubscription.queue)).toBe(1);
      expect(await database.prisma.notificationDelivery.count({ where: { channel: "email", state: "sent" } })).toBe(1);
    }, barrierBudgetMs);
    // Результаты каналов независимы, а оплата и права не зависят от них вовсе.
    expect(await database.prisma.notification.count()).toBe(1);
    expect(await database.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchase.purchaseRef } })).toMatchObject({ state: "confirmed" });
    expect(await database.prisma.billingNotice.count({ where: { accountId: buyer, kind: "payment_succeeded", state: "current" } })).toBe(1);
  } finally { await worker.stop(); }
}, 120_000);
