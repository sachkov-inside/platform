import { grantProductFixture } from "./setup/product-access.js";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { startNotificationBroker } from "./setup/broker.js";
import { expect } from "vitest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  test,
} from "../support/notification-suite-lifecycle.js";

import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { localNotificationTopology } from "../../src/infrastructure/notification-transport/topology.js";
import { assembleNotificationPipeline } from "../../src/entrypoints/notifications-worker/assemble-notification-pipeline.js";
import {
  accountId as checkedAccountId,
  assembleAccounts,
  BillingContact,
  NotificationAccounts,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { stageBillingNotification } from "../../src/modules/billing/facets/notification-outbox/notification-outbox.js";
import {
  BillingNotices,
  BillingPayments,
  type BillingPricing,
} from "../../src/modules/billing/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../../src/modules/account-rights/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import {
  assembleMaterialResourceFacts,
  MaterialAnnouncements,
  materialId as checkedMaterialId,
  type MaterialId,
} from "../../src/modules/materials/index.js";
import { Notifications } from "../../src/modules/notifications/index.js";
import { resultSchema } from "../../src/modules/notifications/domain/notification-wire.js";
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
import {
  providerStand,
  type ProviderStand,
} from "./setup/telegram-provider-stand.js";
import {
  pressedPaymentButton,
  syntheticConsentDocuments,
} from "./setup/consent-documents.js";
import { hasText } from "../../src/infrastructure/contracts/text.js";

registerFixedClock();

// Каждое ожидание заканчивается на зафиксированном факте; бюджет только ограничивает зависший прогон.
const barrierBudgetMs = 45_000;
const origin = "https://inside.example.test";
const config = syntheticTbankConfig({
  environment: "demo",
  terminalKey: "SYNTHETICACCEPT",
  password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 65).toString("base64"),
  minimumKopecks: 100,
  maximumKopecks: 10_000_000,
  returnUrl: `${origin}/account`,
  notificationUrl: `${origin}/billing/tbank/notification`,
  receipt: { taxation: "usn_income", tax: "none" },
});
const documents = syntheticConsentDocuments
  .filter((document) => document.kind === "terms")
  .map((document) => ({
    ...document,
    commercialModel: "product-lifetime-v1" as const,
  }));

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
/** Владельческий результат читается по объявленному виду, а не по форме поля. */

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
  let broker: Awaited<ReturnType<typeof startNotificationBroker>>;
  let stand: ProviderStand;
  let worker: ReturnType<typeof assembleNotificationPipeline>;
  // deterministic-test-allow shared-mutation: beforeAll registers owned resources; afterAll drains cleanup once, including partial setup.
  const cleanup: (() => Promise<void>)[] = [];
  let application: Notifications;
  let pendingRetryResult: Promise<void> | undefined;
  const sent: { subject: string; text: string; email: string }[] = [];
  let beforePublication: Notifications;

  let owner: string;
  let topicId: string;
  const subscriptionProductId = randomUUID();
  let pricing: BillingPricing;
  let contact: BillingContact;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let materials: ReturnType<typeof assembleMaterials>;
  let payments: BillingPayments;

  let bank: BankFixture;
  const codes = new Map<string, string>();

  beforeEach(() => {
    sent.length = 0;
  });

  beforeAll(async () => {
    const topology = localNotificationTopology("inside-test", 200);
    broker = await startNotificationBroker({ topology });
    cleanup.unshift(() => broker.stop());
    platform = await createMigratedTestDatabase();
    cleanup.unshift(() => platform.dispose());
    providerDatabase = await createTestDatabase();
    cleanup.unshift(() => providerDatabase.dispose());
    providerPool = new Pool({ connectionString: providerDatabase.url, max: 4 });
    cleanup.unshift(() => providerPool.end());
    await providerPool.query(`create table provider_effects (
      delivery_ref uuid not null, attempt_ref uuid not null, attempt int not null,
      command_revision int not null, category text not null, state text not null,
      recorded_at timestamptz not null,
      primary key (delivery_ref, attempt_ref), unique (delivery_ref, attempt))`);

    const protection = billingContactProtection(
      Buffer.alloc(32, 66).toString("base64"),
    );

    owner = randomUUID();
    await platform.prisma.account.create({
      data: {
        id: owner,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: owner,
      },
    });
    await platform.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    await platform.prisma.product.create({
      data: {
        id: subscriptionProductId,
        slug: subscriptionProductId,
        name: "Программа подписки приёмки",
      },
    });
    topicId = randomUUID();
    await platform.prisma.topic.create({
      data: { id: topicId, slug: "acceptance-topic", name: "Приёмка" },
    });

    const accounts = assembleAccounts({
      prisma: platform.prisma,
      emailFingerprintKey: "synthetic-acceptance-fingerprint-00",
    });
    grants = assembleAccessGrants({ prisma: platform.prisma, accounts });
    const membership = assembleAccountRights({
      prisma: platform.prisma,
    });
    pricing = assembleTestBillingPricing({
      prisma: platform.prisma,
      accounts,
      sale: { payments: true },
    });
    contact = new BillingContact({
      prisma: platform.prisma,
      emailFingerprintKey: "synthetic-acceptance-fingerprint-00",
      protection,
      documents,
      // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
      now: () => new Date(),
      sendCode: (message) => {
        codes.set(message.challengeRef, message.code);
        return Promise.resolve();
      },
    });
    materials = assembleMaterials({
      prisma: platform.prisma,
      authorPolicy: { canManage: (id) => id === owner },
    });
    const contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: {
        hasMaterialsManage: (id) => Promise.resolve(id === owner),
      },
      accountRights: membership,
    });
    bank = new BankFixture(config);
    const client = bank.client();
    payments = new BillingPayments({
      contentCatalog: new CoverageCatalog(
        platform.prisma,
        new ProductDiscovery(platform.prisma),
      ),
      sale: { payments: true },
      prisma: platform.prisma,
      bank: client,
      contact,
      grants,
    });
    const notices = new BillingNotices({ prisma: platform.prisma });
    const announcements = new MaterialAnnouncements({
      prisma: platform.prisma,
    });
    const contacts = new NotificationAccounts(platform.prisma, protection);
    const links = new TelegramAccountLinks(platform.prisma);
    const assemble = (now: () => Date) =>
      new Notifications(
        {
          prisma: platform.prisma,
          origin,
          now,
          sources: {
            resolve: (event) =>
              event.eventType === "billing.notice-ready"
                ? notices.resolveNotice(event)
                : announcements.resolveAnnouncement(event),
            canRead: async (account, sourceRef) => {
              const decision = await contentAccess.authorize({
                subject: {
                  kind: "account",
                  accountId: checkedAccountId(account),
                },
                resource: {
                  kind: "material",
                  materialId: checkedMaterialId(sourceRef),
                },
                action: "read",
                enforcementPoint: "published_material_read",
                correlationId: "acceptance",
              });
              return decision.effect === "allow"
                ? "allowed"
                : decision.reason === "dependency_unavailable"
                  ? "unavailable"
                  : "denied";
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
              return hasText(link.binding?.telegramIdentityRef) &&
                hasText(link.binding.accountRef)
                ? {
                    channel: "telegram",
                    ...link.binding,
                    accountRef: link.binding.accountRef,
                    telegramIdentityRef: link.binding.telegramIdentityRef,
                  }
                : null;
            },
          },
        },
        accounts,
      );
    // Настройки каналов включаются раньше публикации: доказать opt-in можно только историей,
    // которая ей предшествует.
    beforePublication = assemble(
      distinctClock(() => Date.parse("2026-01-02T00:00:00.000Z")),
    );
    // Команда доставки, собранная из двух чтений часов, живёт дольше, чем принимает её потребитель.
    application = assemble(distinctClock());

    worker = assembleNotificationPipeline({
      config: {
        urls: broker.urls,
        prefetch: 4,
        quarantineCapacity: 200,
      },
      transport: {
        ...application.transport,
        accept: async (envelope) => {
          if (
            pendingRetryResult !== undefined &&
            envelope.lane === "telegramResult" &&
            resultSchema.parse(JSON.parse(envelope.payload)).state ===
              "retrying"
          )
            await pendingRetryResult;
          return application.transport.accept(envelope);
        },
      },
      prisma: platform.prisma,
      processInbox: () =>
        application.sweep((message) => {
          sent.push(message);
          return Promise.resolve({ state: "sent" });
        }),
      report: () => undefined,
    });
    cleanup.unshift(() => worker.stop());
    stand = await providerStand({
      url: broker.url("telegram"),
      pool: providerPool,
      authorize: (request) =>
        application.authorizeDispatch("telegram", request),
    });
    // The provider uses the pool; both stop before their databases and the broker.
    cleanup.splice(1, 0, () => stand.stop());
    await worker.start();
  }, 180_000);

  afterAll(async () => {
    const errors: unknown[] = [];
    for (const close of cleanup.splice(0)) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw new AggregateError(
        errors,
        "Notifications acceptance cleanup failed",
      );
  }, 120_000);

  async function createAccount(): Promise<string> {
    const id = randomUUID();
    await platform.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
      },
    });
    return id;
  }

  /** Provider видит в привязке principal приложения Telegram, а не Account платформы. */
  function principalOf(account: string): string {
    return `principal-${account}`;
  }

  /** Участник с подтверждённым контактом, связанным Telegram и включёнными каналами. */
  async function member(): Promise<string> {
    const id = await createAccount();
    const start = await contact.start(id, {
      operationId: randomUUID(),
      email: `${id}@example.test`,
      expectedRevision: 0,
    });
    if (!start.ok) throw new Error(start.error.code);
    expect(
      await contact.confirm(id, {
        operationId: randomUUID(),
        challengeRef: start.challengeRef,
        code: codes.get(start.challengeRef),
      }),
    ).toMatchObject({ ok: true });
    await platform.prisma.telegramAccountLinkState.create({
      data: {
        accountId: id,
        linkRef: randomUUID(),
        revision: 1,
        principalRef: principalOf(id),
        identityRef: `identity-${id}`,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    expect(
      await beforePublication.changePreferences(id, {
        operationId: randomUUID(),
        expectedRevision: 0,
        email: true,
        telegram: true,
      }),
    ).toMatchObject({ ok: true });
    return id;
  }

  async function offer(input: {
    readonly name: string;
    readonly benefits: readonly string[];
    readonly mode?: "one_time";
    readonly priceKopecks: number;
    readonly benefitPeriods?: readonly {
      capability: string;
      months: number | null;
    }[];
  }) {
    const productId =
      input.benefits.find((c) => c.startsWith("product:"))?.slice(8) ??
      (await productCollection());
    value(
      await pricing.manage(owner, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        value: {
          productId,
          name: input.name,
          priceKopecks: input.priceKopecks,
          published: true,
        },
      }),
    );
    return productId;
  }

  /** Подтверждённая оплата настоящим путём: расчёт, согласия, команда и ответ банка. */
  async function buy(
    account: string,
    optionId: string,
    options: { readonly recurring?: boolean } = {},
  ) {
    const quote = value(
      await pricing.quote(account, {
        operationId: randomUUID(),
        productId: optionId,
        priceRevision: 1,
      }),
    );
    const accepted = await contact.acceptConsents(
      account,
      pressedPaymentButton(
        {
          operationId: randomUUID(),
          contextRef: quote.quoteRef,
          documents: documents
            .filter(
              (document) =>
                options.recurring === true || document.kind === "terms",
            )
            .map((document) => ({
              kind: document.kind,
              documentId: document.documentId,
              version: document.version,
              digest: document.digest,
              accepted: true,
            })),
        },
        { snapshot: quote.snapshot },
      ),
    );
    if (!accepted.ok) throw new Error(accepted.error.code);
    const purchase = value(
      await payments.purchase(account, {
        operationId: randomUUID(),
        quoteRef: quote.quoteRef,
        contactRevision: 1,
        consentEvidenceRefs: accepted.evidenceRefs,
        acknowledgeExistingAccess: false,
      }),
    );
    // Подписка сохраняет способ оплаты доказанным Rebill, иначе смена тарифа ей недоступна.
    if (options.recurring === true) {
      expect(
        await payments.notification(
          bank.notify(purchase.purchaseRef, "AUTHORIZED", {
            RebillId: "synthetic-card",
          }),
        ),
      ).toMatchObject({ ok: true });
    }
    expect(
      await payments.notification(
        bank.notify(purchase.purchaseRef, "CONFIRMED"),
      ),
    ).toMatchObject({ ok: true });
    // Право выдаётся отдельным восстанавливаемым шагом: подтверждение оплаты его только обещает.
    value(await payments.recover());
    return purchase.purchaseRef;
  }

  async function productCollection(): Promise<string> {
    const slug = `acceptance-product-${randomUUID()}`;
    const created = await materials.authoring.createContentCollection({
      actor: owner,
      kind: "product",
      name: slug,
      slug,
      summary: "",
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  }

  /** Первая публикация материала нужного состава через настоящий путь авторской работы. */
  async function publish(
    title: string,
    productIds: readonly string[] = [subscriptionProductId],
  ): Promise<MaterialId> {
    const metadata = {
      title,
      summary: "Материал приёмки уведомлений",
      access: "closed" as const,
      topicId,
      formatId: "guide",
      tagIds: [],
      difficulty: null,
      outcomes: [],
      productIds: [...productIds],
    };
    const created = value(
      await materials.authoring.createDraft({
        actor: owner,
        idempotencyKey: randomUUID(),
        metadata,
        body: representativeDocument(title),
      }),
    );
    value(
      await materials.authoring.saveMaterial({
        actor: owner,
        idempotencyKey: randomUUID(),
        materialId: created.materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata,
        body: representativeDocument(title),
      }),
    );
    return checkedMaterialId(created.materialId);
  }

  function announcementOf(materialId: string) {
    return platform.prisma.materialAnnouncement.findUniqueOrThrow({
      where: { materialId },
    });
  }

  /**
   * Собственный факт этого шага: событие именно этой публикации принято и его аудитория
   * раскрыта до конца. Общий счётчик ленты отвечал бы и до прихода события, и за чужие поводы.
   */
  async function announcementSettled(
    announcementRef: string,
  ): Promise<boolean> {
    const revision =
      await platform.prisma.materialAnnouncementRevision.findFirstOrThrow({
        where: { announcementRef },
        orderBy: { revision: "desc" },
      });
    const inbox = await platform.prisma.notificationInbox.findFirst({
      where: { messageId: revision.messageId },
    });
    return inbox !== null && inbox.completedAt !== null;
  }

  /** Доставки одного повода вместе с их Account и каналом. */
  async function deliveriesOf(occurrenceRef: string) {
    const rows = await platform.prisma.notificationDelivery.findMany({
      where: { notification: { occurrenceRef } },
      select: {
        id: true,
        channel: true,
        state: true,
        reason: true,
        notification: { select: { accountId: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      state: row.state,
      reason: row.reason,
      accountId: row.notification.accountId,
    }));
  }

  test("оба источника доходят до обоих каналов и возвращают результаты", async () => {
    const subscriber = await member();
    const buyerAccount = await member();
    const productId = await productCollection();
    const subscription = await offer({
      name: "Подписка «Материалы»",
      benefits: ["materials"],
      priceKopecks: 100_000,
    });
    const productOffer = await offer({
      name: "Руководство «Приёмка»",
      benefits: [`product:${productId}`, "support"],
      mode: "one_time",
      priceKopecks: 290_000,
      benefitPeriods: [
        { capability: `product:${productId}`, months: null },
        { capability: "support", months: 6 },
      ],
    });

    await buy(subscriber, subscription, { recurring: true });
    await buy(buyerAccount, productOffer);
    const notices = await platform.prisma.billingNotice.findMany({
      where: {
        accountId: { in: [subscriber, buyerAccount] },
        kind: "payment_succeeded",
      },
    });
    // Оба продукта продаются сейчас, и оба дают повод: подписка и разовая покупка руководства.
    expect(notices).toHaveLength(2);

    const material = await publish("Первый материал приёмки", [
      productId,
      subscription,
    ]);
    const announcement = await announcementOf(material);

    for (const occurrenceRef of [
      ...notices.map((notice) => notice.id),
      announcement.id,
    ]) {
      await eventually(async () => {
        expect(stand.failures).toEqual([]);
        expect(stand.refusals).toEqual([]);
        const deliveries = await deliveriesOf(occurrenceRef);
        expect(deliveries.length).toBeGreaterThan(0);
        expect(deliveries.every((delivery) => delivery.state === "sent")).toBe(
          true,
        );
      }, barrierBudgetMs);
    }
    expect(await platform.prisma.notificationQuarantine.count()).toBe(0);

    // Оплата адресована одному Account и приходит обоими каналами независимо от opt-in.
    for (const notice of notices) {
      expect(
        (await deliveriesOf(notice.id))
          .map((delivery) => delivery.channel)
          .toSorted(),
      ).toEqual(["email", "telegram"]);
    }
    // Первая публикация ушла только тем, у кого есть и право, и включённый канал.
    const announced = await deliveriesOf(announcement.id);
    expect(
      [...new Set(announced.map((delivery) => delivery.accountId))].toSorted(),
    ).toEqual([subscriber, buyerAccount].toSorted());

    // Письмо получил подтверждённый адрес, и в нём то самое, что обещано читателю.
    const letter = sent.find((message) =>
      message.text.includes("Первый материал приёмки"),
    );
    expect(letter).toMatchObject({ subject: "Новый материал в Inside" });
    expect(letter?.text).toContain(`${origin}/materials/`);
    expect(
      [subscriber, buyerAccount].map((id) => `${id}@example.test`),
    ).toContain(letter?.email);

    // Провайдер вёл собственный журнал в собственной базе и спрашивал разрешение перед каждой попыткой.
    const telegramDeliveries = [
      ...announced,
      ...(
        await Promise.all(notices.map((notice) => deliveriesOf(notice.id)))
      ).flat(),
    ].filter((delivery) => delivery.channel === "telegram");
    expect(telegramDeliveries.length).toBeGreaterThanOrEqual(4);
    const categories = new Set<string>();
    for (const delivery of telegramDeliveries) {
      const attempts = await stand.attempts(delivery.id);
      expect(attempts.map((attempt) => attempt.state)).toEqual(["sent"]);
      for (const attempt of attempts) categories.add(attempt.category);
    }
    expect(categories).toEqual(new Set(["subscription", "material"]));
    // Базы раздельные: журнал провайдера не виден Platform, а её таблицы — провайдеру.
    const platformTables = await providerPool.query<{ count: string }>(
      `select count(*)::text as count from information_schema.tables where table_schema = 'notifications'`,
    );
    expect(platformTables.rows[0]?.count).toBe("0");
    await expect(
      platform.prisma.$queryRaw`select 1 from provider_effects limit 1`,
    ).rejects.toThrow();
  }, 240_000);

  test("аудитория первой публикации считает действующие права, и один Account получает одно событие", async () => {
    const productId = await productCollection();
    const productOffer = await offer({
      name: `Руководство ${randomUUID()}`,
      benefits: [`product:${productId}`, "support"],
      mode: "one_time",
      priceKopecks: 190_000,
      benefitPeriods: [
        { capability: `product:${productId}`, months: null },
        { capability: "support", months: 6 },
      ],
    });
    const libraryOffer = await offer({
      name: `Подписка ${randomUUID()}`,
      benefits: ["materials"],
      priceKopecks: 100_000,
    });

    const libraryOnly = await member();
    const productOnly = await member();
    const both = await member();
    const stranger = await member();
    await buy(libraryOnly, libraryOffer, { recurring: true });
    await buy(productOnly, productOffer);
    await buy(both, libraryOffer, { recurring: true });
    await buy(both, productOffer);

    const material = await publish("Материал внутри руководства", [
      productId,
      libraryOffer,
    ]);
    const announcement = await announcementOf(material);
    await eventually(async () => {
      const deliveries = await deliveriesOf(announcement.id);
      expect(deliveries.length).toBeGreaterThan(0);
      expect(deliveries.every((delivery) => delivery.state === "sent")).toBe(
        true,
      );
      // Раскрытие аудитории идёт партиями: список полон только когда закрыто само это событие.
      expect(await announcementSettled(announcement.id)).toBe(true);
    }, barrierBudgetMs);

    const audience = await platform.prisma.notification.findMany({
      where: { occurrenceRef: announcement.id },
      select: { accountId: true },
    });
    const reached = audience.map((row) => row.accountId);
    // Право на чтение даёт и подписка, и разовая покупка этого руководства.
    expect(reached).toEqual(
      expect.arrayContaining([libraryOnly, productOnly, both]),
    );
    // Оба основания вместе не удваивают событие: у Account ровно одна Notification.
    expect(reached.filter((id) => id === both)).toHaveLength(1);
    // Включённый канал без права ничего не открывает.
    expect(reached).not.toContain(stranger);
  }, 240_000);

  test("выдача права владельцем не является покупкой и не включает рассылку", async () => {
    const neighbour = await member();
    const libraryOffer = await offer({
      name: `Подписка соседа ${randomUUID()}`,
      benefits: ["materials"],
      priceKopecks: 100_000,
    });
    await buy(neighbour, libraryOffer, { recurring: true });
    const granted = await createAccount();
    await grantProductFixture(platform.prisma, granted, libraryOffer);

    // Открытое право не является оплатой: ни платежа, ни повода, ни сообщения о нём.
    expect(
      await platform.prisma.billingPurchase.count({
        where: { accountId: granted },
      }),
    ).toBe(0);
    expect(
      await platform.prisma.billingNotice.count({
        where: { accountId: granted },
      }),
    ).toBe(0);
    // И не включает рассылку о новых материалах: согласие остаётся выключенным по умолчанию.
    expect(
      await platform.prisma.notificationPreference.findUnique({
        where: { accountId: granted },
      }),
    ).toBeNull();

    // Отсутствие доказывается только после того, как сама рассылка закрыта: рядом стоит
    // участник, которому она полагается, и его сообщение — закреплённый факт этого шага.
    const material = await publish("Материал после выдачи права", [
      libraryOffer,
    ]);
    const announcement = await announcementOf(material);
    await eventually(async () => {
      expect(await announcementSettled(announcement.id)).toBe(true);
      expect(
        await platform.prisma.notification.count({
          where: { occurrenceRef: announcement.id, accountId: neighbour },
        }),
      ).toBe(1);
    }, barrierBudgetMs);
    expect(
      await platform.prisma.notification.count({
        where: { occurrenceRef: announcement.id, accountId: granted },
      }),
    ).toBe(0);
  }, 240_000);

  test("отложенный ответ канала требует нового разрешения и не выдаётся за отправку", async () => {
    const limited = await member();
    const optionId = await offer({
      name: `Подписка предела ${randomUUID()}`,
      benefits: ["materials"],
      priceKopecks: 100_000,
    });
    let releaseRetryResult!: () => void;
    // Результат sent может зафиксироваться раньше retrying: закрепляем этот порядок без паузы.
    pendingRetryResult = new Promise<void>((resolve) => {
      releaseRetryResult = resolve;
    });
    stand.policy((command, attempt) =>
      command.binding.accountRef === principalOf(limited) && attempt === 1
        ? { state: "retrying", reason: "rate_limited", retryAfterMs: 1_000 }
        : { state: "sent" },
    );
    try {
      await buy(limited, optionId, { recurring: true });
      const notice = await platform.prisma.billingNotice.findFirstOrThrow({
        where: { accountId: limited, kind: "payment_succeeded" },
      });
      await eventually(async () => {
        const telegram = (await deliveriesOf(notice.id)).filter(
          (delivery) => delivery.channel === "telegram",
        );
        expect(telegram).toHaveLength(1);
        expect(telegram[0]?.state).toBe("sent");
      }, barrierBudgetMs);

      const telegram = (await deliveriesOf(notice.id)).find(
        (delivery) => delivery.channel === "telegram",
      );
      if (!telegram) throw new Error("telegram delivery expected");
      // Отложенный ответ не закрывает доставку: следующая попытка берёт своё разрешение и
      // остаётся отдельной попыткой со своим attemptRef. Сама задержка и общая ёмкость бота
      // принадлежат приложению Telegram и проверены у него.
      const attempts = await stand.attempts(telegram.id);
      expect(attempts.map((attempt) => attempt.state)).toEqual([
        "retrying",
        "sent",
      ]);
      expect(new Set(attempts.map((attempt) => attempt.attemptRef)).size).toBe(
        2,
      );
      // sent фиксирует текущий результат, но не завершает обработку предыдущей попытки.
      expect(
        await platform.prisma.notificationResult.count({
          where: { deliveryId: telegram.id },
        }),
      ).toBe(1);
      releaseRetryResult();
      // Обе попытки объявлены отдельными результатами; отложенная не выдана за отправку.
      await eventually(async () => {
        const results = await platform.prisma.notificationResult.findMany({
          where: { deliveryId: telegram.id },
          orderBy: { revision: "asc" },
        });
        expect(results).toHaveLength(2);
        expect(JSON.parse(results[0]?.payload ?? "{}")).toMatchObject({
          state: "retrying",
          reason: "rate_limited",
        });
        expect(JSON.parse(results[1]?.payload ?? "{}")).toMatchObject({
          state: "sent",
        });
      }, barrierBudgetMs);
    } finally {
      releaseRetryResult();
      pendingRetryResult = undefined;
      stand.policy(() => ({ state: "sent" }));
    }
  }, 240_000);

  test("разрыв связи Telegram закрывает ещё не начатую отправку", async () => {
    const unlinked = await member();
    const optionId = await offer({
      name: `Подписка связи ${randomUUID()}`,
      benefits: ["materials"],
      priceKopecks: 100_000,
    });
    // Команда ставится, пока связь ещё действует, и ждёт разбора: разрыв приходит между этими шагами.
    stand.pause();
    try {
      await buy(unlinked, optionId, { recurring: true });
      const notice = await platform.prisma.billingNotice.findFirstOrThrow({
        where: { accountId: unlinked, kind: "payment_succeeded" },
      });
      let telegramRef = "";
      await eventually(async () => {
        const telegram = (await deliveriesOf(notice.id)).filter(
          (delivery) => delivery.channel === "telegram",
        );
        expect(telegram).toHaveLength(1);
        expect(telegram[0]?.state).toBe("accepted");
        telegramRef = telegram[0]?.id ?? "";
      }, barrierBudgetMs);

      await platform.prisma.telegramAccountLinkState.delete({
        where: { accountId: unlinked },
      });
      stand.resume();

      await eventually(() => {
        expect(stand.refusals).toContainEqual({
          deliveryRef: telegramRef,
          outcome: "binding_conflict",
        });
        return Promise.resolve();
      }, barrierBudgetMs);
      // Отправки не было и результата нет: разорванная связь не превращается в отправленное.
      expect(await stand.attempts(telegramRef)).toEqual([]);
      expect(
        await platform.prisma.notificationResult.count({
          where: { deliveryId: telegramRef },
        }),
      ).toBe(0);
      expect(
        await platform.prisma.notificationDelivery.findUniqueOrThrow({
          where: { id: telegramRef },
        }),
      ).toMatchObject({ state: "accepted" });
      // Второй канал того же повода не пострадал.
      await eventually(async () => {
        const email = (await deliveriesOf(notice.id)).filter(
          (delivery) => delivery.channel === "email",
        );
        expect(email[0]?.state).toBe("sent");
      }, barrierBudgetMs);
    } finally {
      stand.resume();
    }
  }, 240_000);

  test("заполненная лента подписки не задерживает ленту новых материалов", async () => {
    const reader = await member();
    const optionId = await offer({
      name: `Подписка очереди ${randomUUID()}`,
      benefits: ["materials"],
      priceKopecks: 100_000,
    });
    await buy(reader, optionId, { recurring: true });
    const readerNotice = await platform.prisma.billingNotice.findFirstOrThrow({
      where: { accountId: reader, kind: "payment_succeeded" },
    });
    await eventually(async () => {
      const deliveries = await deliveriesOf(readerNotice.id);
      expect(deliveries.length).toBeGreaterThan(0);
      expect(deliveries.every((delivery) => delivery.state === "sent")).toBe(
        true,
      );
    }, barrierBudgetMs);

    // Объём чужой ленты, а не её содержимое. Это независимость лент, а не честность раскрытия
    // аудитории одного события: разбиение большой аудитории на партии проверяет notifications.test.
    const backlog = 30;
    // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
    const instant = new Date();
    for (let index = 0; index < backlog; index += 1) {
      await platform.prisma.$transaction((transaction) =>
        stageBillingNotification(transaction, {
          contractVersion: "inside.notification-event.v1",
          messageId: randomUUID(),
          occurrenceRef: randomUUID(),
          sourceRef: randomUUID(),
          sourceRevision: 1,
          eventType: "billing.notice-ready",
          accountRef: reader,
          kind: "payment_succeeded",
          occurredAt: instant.toISOString(),
          notAfter: new Date(instant.getTime() + 3_600_000).toISOString(),
        }),
      );
    }
    const material = await publish("Материал при нагруженной ленте подписки", [
      optionId,
    ]);
    const announcement = await announcementOf(material);

    let backlogWhenAnnounced = 0;
    await eventually(async () => {
      // Невыполненная работа ленты подписки целиком: и то, что ещё не ушло в брокер, и то, что
      // уже принято, но не разобрано.
      backlogWhenAnnounced =
        (await platform.prisma.billingNotificationOutbox.count({
          where: { publishedAt: null },
        })) +
        (await platform.prisma.notificationInbox.count({
          where: { lane: "billing", completedAt: null },
        }));
      expect(
        await platform.prisma.notification.count({
          where: { occurrenceRef: announcement.id },
        }),
      ).toBeGreaterThan(0);
    }, barrierBudgetMs);
    // Новая публикация прошла, пока лента подписки ещё разбирает свою очередь: общий проход
    // делает ограниченный шаг по каждой ленте, а не выбирает одну до конца.
    expect(backlogWhenAnnounced).toBeGreaterThan(0);
  }, 240_000);
});
