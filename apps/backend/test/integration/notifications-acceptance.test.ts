import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { tbankConfigSchema } from "../../src/config/tbank-config.js";
import {
  localNotificationTopology,
  NOTIFICATION_BROKER_IMAGE,
} from "../../src/infrastructure/notification-transport/topology.js";
import { assembleNotificationWorker } from "../../src/infrastructure/notification-transport/worker.js";
import {
  accountId as checkedAccountId,
  assembleAccounts,
  BillingContact,
  NotificationAccounts,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { stageBillingNotification } from "../../src/modules/billing/facets/notification-outbox/notification-outbox.js";
import {
  assembleBillingNotificationOutbox,
  BillingNotices,
  BillingOperations,
  BillingPayments,
  BillingPricing,
  BillingSubscriptions,
} from "../../src/modules/billing/index.js";
import type { OwnerOutcome, OwnerResult } from "../../src/modules/billing/domain/owner-operations.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import {
  assembleAccessGrants,
  assembleMembershipEntitlements,
} from "../../src/modules/membership-entitlements/index.js";
import {
  assembleMaterialResourceFacts,
  assembleMaterials,
  assembleMaterialsNotificationOutbox,
  MaterialAnnouncements,
  materialId as checkedMaterialId,
  type MaterialId,
} from "../../src/modules/materials/index.js";
import { Notifications } from "../../src/modules/notifications/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { BankFixture } from "./setup/bank.js";

import { distinctClock } from "./setup/distinct-clock.js";
import { eventually } from "./setup/eventually.js";
import {
  createMigratedTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { providerStand, type ProviderStand } from "./setup/telegram-provider-stand.js";

// Каждое ожидание заканчивается на зафиксированном факте; бюджет только ограничивает зависший прогон.
const barrierBudgetMs = 45_000;
const origin = "https://inside.example.test";
const config = tbankConfigSchema.parse({
  environment: "demo", terminalKey: "SYNTHETICACCEPT", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 65).toString("base64"), recurringCardConfirmed: true,
  cardOnlyHostedConfirmed: true, cardBinding: { confirmed: true, checkType: "3DS" },
  minimumKopecks: 100, maximumKopecks: 10_000_000, returnUrl: `${origin}/account`,
  notificationUrl: `${origin}/billing/tbank/notification`, receipt: { taxation: "usn_income", tax: "none" },
});
const documents = (["terms", "recurring"] as const).map((kind) => {
  const text = `Synthetic ${kind}, not legal terms`;
  return { kind, documentId: kind, version: "test-v1", text,
    digest: createHash("sha256").update(text).digest("hex"), url: `https://example.test/${kind}` };
});

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
/** Владельческий результат читается по объявленному виду, а не по форме поля. */
function success(result: OwnerResult): OwnerOutcome {
  if (!result.ok) throw new Error(result.error.code);
  return result.result;
}

/**
 * Сквозная приёмка общей системы уведомлений: оба источника — подтверждённая оплата Billing и
 * первая публикация Materials — проходят настоящий RabbitMQ, раскрытие аудитории, оба канала и
 * возврат результатов.
 *
 * Платформа и провайдер Telegram держат раздельные базы PostgreSQL и делят только брокер: кода
 * приложения `inside-telegram` здесь нет и быть не может — граница репозиториев запрещает
 * runtime-зависимость на соседний checkout. Провайдер синтетический, но верен контракту: он
 * разбирает команду теми же правилами провода, спрашивает у Platform preflight перед каждой
 * попыткой, ведёт собственный журнал и возвращает результат своей лентой. Банк и SMTP тоже
 * синтетические. Это runtime-доказательство, а не доказательство реальной внешней доставки.
 */
describe("приёмка обоих источников Notifications (реальные RabbitMQ и PostgreSQL)", () => {
  let platform: TestDatabase;
  let providerDatabase: TestDatabase;
  let providerPool: Pool;
  let broker: Awaited<ReturnType<GenericContainer["start"]>>;
  let stand: ProviderStand;
  let worker: ReturnType<typeof assembleNotificationWorker>;
  let application: Notifications;
  const sent: { subject: string; text: string; email: string }[] = [];
  let preferencesAt: Notifications;

  let owner: string;
  let topicId: string;
  let pricing: BillingPricing;
  let contact: BillingContact;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let materials: ReturnType<typeof assembleMaterials>;
  let payments: BillingPayments;
  let operations: BillingOperations;
  let bank: BankFixture;
  const codes = new Map<string, string>();

  beforeAll(async () => {
    const topology = localNotificationTopology("inside-test", 200);
    broker = await new GenericContainer(NOTIFICATION_BROKER_IMAGE)
      .withExposedPorts(5672)
      .withCopyContentToContainer([
        { content: JSON.stringify(topology), target: "/etc/rabbitmq/definitions.json" },
        { content: "definitions.import_backend = local_filesystem\ndefinitions.local.path = /etc/rabbitmq/definitions.json\n",
          target: "/etc/rabbitmq/rabbitmq.conf" },
      ])
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
      .start();
    platform = await createMigratedTestDatabase();
    providerDatabase = await createTestDatabase();
    providerPool = new Pool({ connectionString: providerDatabase.url, max: 4 });
    await providerPool.query(`create table provider_effects (
      delivery_ref uuid not null, attempt_ref uuid not null, command_revision int not null,
      category text not null, state text not null, recorded_at timestamptz not null,
      primary key (delivery_ref, attempt_ref))`);

    const url = (principal: string) =>
      `amqp://local-${principal}:inside-local-only@${broker.getHost()}:${broker.getMappedPort(5672)}/inside-test`;
    const protection = billingContactProtection(Buffer.alloc(32, 66).toString("base64"));

    owner = randomUUID();
    await platform.prisma.account.create({
      data: { id: owner, logtoIssuer: "https://identity.example.test", logtoSubject: owner },
    });
    await platform.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    topicId = randomUUID();
    await platform.prisma.topic.create({
      data: { id: topicId, slug: "acceptance-topic", name: "Приёмка" },
    });

    const accounts = assembleAccounts({
      prisma: platform.prisma, emailFingerprintKey: "synthetic-acceptance-fingerprint-00",
    });
    grants = assembleAccessGrants({ prisma: platform.prisma, accounts });
    const membership = assembleMembershipEntitlements({
      prisma: platform.prisma,
      workshopEntitlements: assembleWorkshopEntitlements({ prisma: platform.prisma }),
    });
    pricing = new BillingPricing({ prisma: platform.prisma, accounts });
    contact = new BillingContact({
      prisma: platform.prisma, protection, documents, now: () => new Date(),
      sendCode: (message) => { codes.set(message.challengeRef, message.code); return Promise.resolve(); },
    });
    materials = assembleMaterials({
      prisma: platform.prisma, authorPolicy: { canManage: (id) => id === owner },
    });
    const contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent),
      accountPermissions: { hasMaterialsManage: (id) => Promise.resolve(id === owner) },
      membershipEntitlements: membership,
    });
    bank = new BankFixture(config);
    const client = bank.client();
    payments = new BillingPayments({ prisma: platform.prisma, bank: client, contact, grants });
    const notices = new BillingNotices({ prisma: platform.prisma });
    const subscriptions = new BillingSubscriptions({
      prisma: platform.prisma, bank: client, contact, grants, payments, notices,
    });
    operations = new BillingOperations({
      prisma: platform.prisma, accounts, pricing, payments, subscriptions, grants, bank: client,
    });
    const announcements = new MaterialAnnouncements({ prisma: platform.prisma });
    const contacts = new NotificationAccounts(platform.prisma, protection);
    const links = new TelegramAccountLinks(platform.prisma);
    const assemble = (now: () => Date) =>
      new Notifications({
        prisma: platform.prisma, origin, now,
        sources: {
          resolve: (event) =>
            event.eventType === "billing.notice-ready"
              ? notices.resolveNotice(event)
              : announcements.resolveAnnouncement(event),
          canRead: async (account, sourceRef) => {
            const decision = await contentAccess.authorize({
              subject: { kind: "account", accountId: checkedAccountId(account) },
              resource: { kind: "material", materialId: checkedMaterialId(sourceRef) },
              action: "read", enforcementPoint: "published_material_read", correlationId: "acceptance",
            });
            return decision.effect === "allow"
              ? "allowed"
              : decision.reason === "dependency_unavailable" ? "unavailable" : "denied";
          },
        },
        recipients: {
          exists: (id) => contacts.exists(id),
          enumerate: (query) => contacts.enumerate(query),
          email: (binding) => contacts.email(binding),
          binding: async (account, channel) => {
            if (channel === "email") return contacts.binding(account);
            const link = await links.readBinding({ accountId: account });
            if (!link.ok) throw new Error("notification_binding_unavailable");
            return link.binding?.telegramIdentityRef && link.binding.accountRef
              ? { channel: "telegram", ...link.binding, accountRef: link.binding.accountRef,
                  telegramIdentityRef: link.binding.telegramIdentityRef }
              : null;
          },
        },
      }, accounts);
    // Настройки каналов включаются раньше публикации: доказать opt-in можно только историей,
    // которая ей предшествует.
    preferencesAt = assemble(distinctClock(() => Date.parse("2026-01-02T00:00:00.000Z")));
    // Команда доставки, собранная из двух чтений часов, живёт дольше, чем принимает её потребитель.
    application = assemble(distinctClock());

    worker = assembleNotificationWorker({
      config: {
        urls: { billing: url("billing"), materials: url("materials"),
          notifications: url("notifications"), email: url("email") },
        prefetch: 4, quarantineCapacity: 200,
      },
      transport: application.transport,
      billing: assembleBillingNotificationOutbox(platform.prisma),
      materials: assembleMaterialsNotificationOutbox(platform.prisma),
      processInbox: () => application.sweep((message) => {
        sent.push(message);
        return Promise.resolve({ state: "sent" });
      }),
      report: () => undefined,
    });
    stand = await providerStand({
      url: url("telegram"), pool: providerPool,
      authorize: (request) => application.authorizeDispatch("telegram", request),
    });
    await worker.start();
  }, 180_000);

  afterAll(async () => {
    await worker.stop().catch(() => undefined);
    await stand.stop().catch(() => undefined);
    await providerPool.end().catch(() => undefined);
    await providerDatabase.dispose().catch(() => undefined);
    await platform.dispose().catch(() => undefined);
    await broker.stop().catch(() => undefined);
  }, 120_000);

  /** Provider видит в привязке principal приложения Telegram, а не Account платформы. */
  function principalOf(account: string): string {
    return `principal-${account}`;
  }

  /** Участник с подтверждённым контактом, связанным Telegram и включёнными каналами. */
  async function member(): Promise<string> {
    const id = randomUUID();
    await platform.prisma.account.create({
      data: { id, logtoIssuer: "https://identity.example.test", logtoSubject: id },
    });
    expect(await grants.classifyLegacy(owner, {
      operationId: randomUUID(), accountId: id, expectedRevision: 0, classification: "confirmed_new",
      sourceRef: id, reason: "Синтетический участник приёмки", bridgeEnabled: false, tributeStopped: false,
    })).toMatchObject({ ok: true });
    const start = await contact.start(id, { operationId: randomUUID(), email: `${id}@example.test`, expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    expect(await contact.confirm(id, {
      operationId: randomUUID(), challengeRef: start.challengeRef, code: codes.get(start.challengeRef),
    })).toMatchObject({ ok: true });
    await platform.prisma.telegramAccountLinkState.create({
      data: { accountId: id, linkRef: randomUUID(), revision: 1, principalRef: principalOf(id),
        identityRef: `identity-${id}`, updatedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    expect(await preferencesAt.changePreferences(id, {
      operationId: randomUUID(), expectedRevision: 0, email: true, telegram: true,
    })).toMatchObject({ ok: true });
    return id;
  }

  async function offer(input: {
    readonly name: string; readonly benefits: readonly string[];
    readonly mode?: "one_time"; readonly priceKopecks: number;
    readonly benefitPeriods?: readonly { capability: string; months: number | null }[];
  }) {
    const offerId = randomUUID(), optionId = randomUUID();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save",
      value: { id: offerId, name: input.name, benefits: [...input.benefits],
        ...(input.benefitPeriods ? { benefitPeriods: [...input.benefitPeriods] } : {}) } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save",
      value: { id: optionId, offerId, ...(input.mode ? { mode: input.mode } : {}), months: 1, priceKopecks: input.priceKopecks } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));
    return optionId;
  }

  /** Подтверждённая оплата настоящим путём: расчёт, согласия, команда и ответ банка. */
  async function buy(account: string, optionId: string, options: { readonly recurring?: boolean } = {}) {
    const quote = value(await pricing.quote(account, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
    const accepted = await contact.acceptConsents(account, {
      operationId: randomUUID(), contextRef: quote.quoteRef,
      documents: documents.filter((document) => options.recurring === true || document.kind === "terms")
        .map((document) => ({ kind: document.kind, documentId: document.documentId,
          version: document.version, digest: document.digest, accepted: true })),
    });
    if (!accepted.ok) throw new Error(accepted.error.code);
    const purchase = value(await payments.purchase(account, {
      operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1,
      consentEvidenceRefs: accepted.evidenceRefs, acknowledgeExistingAccess: false,
    }));
    expect(await payments.notification(bank.notify(purchase.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
    // Право выдаётся отдельным восстанавливаемым шагом: подтверждение оплаты его только обещает.
    value(await payments.recover());
    return purchase.purchaseRef;
  }

  async function guideCollection(): Promise<string> {
    const slug = `acceptance-guide-${randomUUID()}`;
    const created = await materials.authoring.createContentCollection({
      actor: owner, kind: "guide", name: slug, slug, summary: "",
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  }

  /** Первая публикация материала нужного состава через настоящий путь авторской работы. */
  async function publish(title: string, guideIds: readonly string[] = []): Promise<MaterialId> {
    const metadata = { title, summary: "Материал приёмки уведомлений", access: "membership" as const,
      topicId, formatId: "guide", tagIds: [], seriesIds: [...guideIds] };
    const created = value(await materials.authoring.createDraft({
      actor: owner, idempotencyKey: randomUUID(), metadata, body: representativeDocument(title),
    }));
    value(await materials.authoring.saveMaterial({
      actor: owner, idempotencyKey: randomUUID(), materialId: created.materialId,
      expectedContentVersion: 1, publicationState: "published", metadata, body: representativeDocument(title),
    }));
    return checkedMaterialId(created.materialId);
  }

  function announcementOf(materialId: string) {
    return platform.prisma.materialAnnouncement.findUniqueOrThrow({ where: { materialId } });
  }

  /** Доставки одного повода вместе с их Account и каналом. */
  async function deliveriesOf(occurrenceRef: string) {
    const rows = await platform.prisma.notificationDelivery.findMany({
      where: { notification: { occurrenceRef } },
      select: { id: true, channel: true, state: true, reason: true, notification: { select: { accountId: true } } },
    });
    return rows.map((row) => ({ id: row.id, channel: row.channel, state: row.state,
      reason: row.reason, accountId: row.notification.accountId }));
  }

  test("оба источника доходят до обоих каналов и возвращают результаты", async () => {
    const subscriber = await member();
    const buyerAccount = await member();
    const subscription = await offer({ name: "Подписка «Материалы»", benefits: ["materials"], priceKopecks: 100_000 });
    const guideId = await guideCollection();
    const guideOffer = await offer({ name: "Руководство «Приёмка»", benefits: [`guide:${guideId}`],
      mode: "one_time", priceKopecks: 290_000, benefitPeriods: [{ capability: `guide:${guideId}`, months: null }] });

    await buy(subscriber, subscription, { recurring: true });
    await buy(buyerAccount, guideOffer);
    const notices = await platform.prisma.billingNotice.findMany({
      where: { accountId: { in: [subscriber, buyerAccount] }, kind: "payment_succeeded" },
    });
    // Оба продукта продаются сейчас, и оба дают повод: подписка и разовая покупка руководства.
    expect(notices).toHaveLength(2);

    const material = await publish("Первый материал приёмки", [guideId]);
    const announcement = await announcementOf(material);

    for (const occurrenceRef of [...notices.map((notice) => notice.id), announcement.id]) {
      await eventually(async () => {
        expect(await platform.prisma.notificationQuarantine.count()).toBe(0);
        expect(stand.failures).toEqual([]);
        expect(stand.refusals).toEqual([]);
        const deliveries = await deliveriesOf(occurrenceRef);
        expect(deliveries.length).toBeGreaterThan(0);
        expect(deliveries.every((delivery) => delivery.state === "sent")).toBe(true);
      }, barrierBudgetMs);
    }

    // Оплата адресована одному Account и приходит обоими каналами независимо от opt-in.
    for (const notice of notices) {
      expect((await deliveriesOf(notice.id)).map((delivery) => delivery.channel).toSorted())
        .toEqual(["email", "telegram"]);
    }
    // Первая публикация ушла только тем, у кого есть и право, и включённый канал.
    const announced = await deliveriesOf(announcement.id);
    expect([...new Set(announced.map((delivery) => delivery.accountId))].toSorted())
      .toEqual([subscriber, buyerAccount].toSorted());

    // Провайдер вёл собственный журнал в собственной базе и спрашивал разрешение перед каждой попыткой.
    const attempts = await stand.attempts();
    expect(attempts.length).toBeGreaterThanOrEqual(4);
    expect(attempts.every((attempt) => attempt.state === "sent")).toBe(true);
    expect(new Set(attempts.map((attempt) => attempt.category))).toEqual(new Set(["subscription", "material"]));
    // Базы раздельные: журнал провайдера не виден Platform, а её таблицы — провайдеру.
    const platformTables = await providerPool.query<{ count: string }>(
      `select count(*)::text as count from information_schema.tables where table_schema = 'notifications'`);
    expect(platformTables.rows[0]?.count).toBe("0");
    await expect(platform.prisma.$queryRaw`select 1 from provider_effects limit 1`).rejects.toThrow();
  }, 240_000);

  test("аудитория первой публикации считает действующие права, и один Account получает одно событие", async () => {
    const guideId = await guideCollection();
    const guideOffer = await offer({ name: `Руководство ${randomUUID()}`, benefits: [`guide:${guideId}`],
      mode: "one_time", priceKopecks: 190_000, benefitPeriods: [{ capability: `guide:${guideId}`, months: null }] });
    const libraryOffer = await offer({ name: `Подписка ${randomUUID()}`, benefits: ["materials"], priceKopecks: 100_000 });

    const libraryOnly = await member();
    const guideOnly = await member();
    const both = await member();
    const stranger = await member();
    await buy(libraryOnly, libraryOffer, { recurring: true });
    await buy(guideOnly, guideOffer);
    await buy(both, libraryOffer, { recurring: true });
    await buy(both, guideOffer);

    const material = await publish("Материал внутри руководства", [guideId]);
    const announcement = await announcementOf(material);
    await eventually(async () => {
      const deliveries = await deliveriesOf(announcement.id);
      expect(deliveries.length).toBeGreaterThan(0);
      expect(deliveries.every((delivery) => delivery.state === "sent")).toBe(true);
      // Раскрытие аудитории идёт партиями: пока источник не закрыт, список ещё пополняется.
      expect(await platform.prisma.notificationInbox.count({
        where: { lane: "materials", completedAt: null },
      })).toBe(0);
    }, barrierBudgetMs);

    const audience = await platform.prisma.notification.findMany({
      where: { occurrenceRef: announcement.id }, select: { accountId: true },
    });
    const reached = audience.map((row) => row.accountId);
    // Право на чтение даёт и подписка, и разовая покупка этого руководства.
    expect(reached).toEqual(expect.arrayContaining([libraryOnly, guideOnly, both]));
    // Оба основания вместе не удваивают событие: у Account ровно одна Notification.
    expect(reached.filter((id) => id === both)).toHaveLength(1);
    // Включённый канал без права ничего не открывает.
    expect(reached).not.toContain(stranger);
  }, 240_000);

  test("выдача права владельцем не является покупкой и не включает рассылку", async () => {
    const granted = randomUUID();
    await platform.prisma.account.create({
      data: { id: granted, logtoIssuer: "https://identity.example.test", logtoSubject: granted },
    });
    const preview = success(await operations.execute(owner, {
      operation: "grants.previewBatch", operationId: randomUUID(),
      rows: [{ rowKey: "acceptance", accountId: granted, source: "manual", sourceRef: randomUUID(),
        terms: { capabilities: ["materials"], startsAt: new Date().toISOString(), validUntil: null,
          reason: "Синтетическая выдача приёмки" } }],
    }));
    if (preview.outcome !== "grantPreview") throw new Error(`Unexpected outcome ${preview.outcome}`);
    expect(success(await operations.execute(owner, {
      operation: "grants.applyBatch", operationId: randomUUID(), previewRef: preview.previewRef,
      expectedRevision: preview.revision, confirmedRows: ["acceptance"],
    })).outcome).toBe("grantBatch");

    // Открытое право не является оплатой: ни платежа, ни повода, ни сообщения о нём.
    expect(await platform.prisma.billingPurchase.count({ where: { accountId: granted } })).toBe(0);
    expect(await platform.prisma.billingNotice.count({ where: { accountId: granted } })).toBe(0);
    // И не включает рассылку о новых материалах: согласие остаётся выключенным по умолчанию.
    expect(await platform.prisma.notificationPreference.findUnique({ where: { accountId: granted } })).toBeNull();

    const material = await publish("Материал после выдачи права");
    const announcement = await announcementOf(material);
    await eventually(async () => {
      expect(await platform.prisma.notificationInbox.count({
        where: { lane: "materials", completedAt: null },
      })).toBe(0);
    }, barrierBudgetMs);
    expect(await platform.prisma.notification.count({
      where: { occurrenceRef: announcement.id, accountId: granted },
    })).toBe(0);
  }, 240_000);

  test("общий предел канала откладывает попытку и не выдаётся за отправку", async () => {
    const limited = await member();
    const optionId = await offer({ name: `Подписка предела ${randomUUID()}`, benefits: ["materials"], priceKopecks: 100_000 });
    stand.policy((command, attempt) =>
      command.binding.accountRef === principalOf(limited) && attempt === 1
        ? { state: "retrying", reason: "rate_limited", retryAfterMs: 1_000 }
        : { state: "sent" });
    try {
      await buy(limited, optionId, { recurring: true });
      const notice = await platform.prisma.billingNotice.findFirstOrThrow({
        where: { accountId: limited, kind: "payment_succeeded" },
      });
      await eventually(async () => {
        const telegram = (await deliveriesOf(notice.id)).filter((delivery) => delivery.channel === "telegram");
        expect(telegram).toHaveLength(1);
        expect(telegram[0]?.state).toBe("sent");
      }, barrierBudgetMs);

      const telegram = (await deliveriesOf(notice.id)).find((delivery) => delivery.channel === "telegram");
      if (!telegram) throw new Error("telegram delivery expected");
      // Отложенная попытка осталась отдельной попыткой провайдера с собственным attemptRef.
      const attempts = await stand.attempts(telegram.id);
      expect(attempts.map((attempt) => attempt.state)).toEqual(["retrying", "sent"]);
      expect(new Set(attempts.map((attempt) => attempt.attemptRef)).size).toBe(2);
      // Обе попытки объявлены Platform отдельными результатами; отложенная не выдана за отправку.
      const results = await platform.prisma.notificationResult.findMany({
        where: { deliveryId: telegram.id }, orderBy: { revision: "asc" },
      });
      expect(results).toHaveLength(2);
      expect(JSON.parse(results[0]?.payload ?? "{}")).toMatchObject({ state: "retrying", reason: "rate_limited" });
      expect(JSON.parse(results[1]?.payload ?? "{}")).toMatchObject({ state: "sent" });
    } finally {
      stand.policy(() => ({ state: "sent" }));
    }
  }, 240_000);

  test("нагруженная лента подписки не оставляет новые материалы без очереди", async () => {
    const reader = await member();
    const optionId = await offer({ name: `Подписка очереди ${randomUUID()}`, benefits: ["materials"], priceKopecks: 100_000 });
    await buy(reader, optionId, { recurring: true });
    await eventually(async () => {
      expect(await platform.prisma.notificationInbox.count({ where: { completedAt: null } })).toBe(0);
    }, barrierBudgetMs);

    // Объём чужой ленты, а не её содержимое: каждое событие занимает свой проход ленты подписки.
    const backlog = 30;
    const instant = new Date();
    for (let index = 0; index < backlog; index += 1) {
      await platform.prisma.$transaction((transaction) => stageBillingNotification(transaction, {
        contractVersion: "inside.notification-event.v1", messageId: randomUUID(),
        occurrenceRef: randomUUID(), sourceRef: randomUUID(), sourceRevision: 1,
        eventType: "billing.notice-ready", accountRef: reader, kind: "payment_succeeded",
        occurredAt: instant.toISOString(), notAfter: new Date(instant.getTime() + 3_600_000).toISOString(),
      }));
    }
    const material = await publish("Материал при нагруженной ленте подписки");
    const announcement = await announcementOf(material);

    let backlogWhenAnnounced = 0;
    await eventually(async () => {
      // Невыполненная работа ленты подписки целиком: и то, что ещё не ушло в брокер, и то, что
      // уже принято, но не разобрано.
      backlogWhenAnnounced =
        await platform.prisma.billingNotificationOutbox.count({ where: { publishedAt: null } }) +
        await platform.prisma.notificationInbox.count({ where: { lane: "billing", completedAt: null } });
      expect(await platform.prisma.notification.count({ where: { occurrenceRef: announcement.id } }))
        .toBeGreaterThan(0);
    }, barrierBudgetMs);
    // Новая публикация прошла, пока лента подписки ещё разбирает свою очередь.
    expect(backlogWhenAnnounced).toBeGreaterThan(0);
  }, 240_000);
});
