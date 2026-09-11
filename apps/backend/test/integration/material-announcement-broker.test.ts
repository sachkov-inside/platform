import { randomUUID } from "node:crypto";
import { GenericContainer, Wait } from "testcontainers";
import { expect, onTestFinished, test } from "vitest";

import { assembleNotificationWorker } from "../../src/infrastructure/notification-transport/worker.js";
import {
  localNotificationTopology,
  NOTIFICATION_BROKER_IMAGE,
} from "../../src/infrastructure/notification-transport/topology.js";
import { lanes } from "../../src/infrastructure/notification-transport/wire.js";
import {
  accountId as checkedAccountId,
  assembleAccounts,
  NotificationAccounts,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleBillingNotificationOutbox } from "../../src/modules/billing/index.js";
import {
  assembleMaterials,
  assembleMaterialsNotificationOutbox,
  MaterialAnnouncements,
  materialId as checkedMaterialId,
} from "../../src/modules/materials/index.js";
import { Notifications } from "../../src/modules/notifications/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { brokerAdmin, queueDepth } from "./setup/broker.js";
import { distinctClock } from "./setup/distinct-clock.js";
import { eventually } from "./setup/eventually.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";

// Каждое ожидание заканчивается на зафиксированном факте; бюджет только ограничивает зависший прогон.
const barrierBudgetMs = 30_000;
const origin = "https://inside.example.test";
const ownerId = "73000000-0000-4000-8000-000000000001";
const topicId = "73000000-0000-4000-8000-000000000002";

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/**
 * Первая публикация материала проходит весь путь через настоящий брокер: outbox Materials,
 * очередь событий, раскрытие аудитории общим Notifications, письмо и команда Telegram в своей
 * очереди. Каналы включены участником заранее; SMTP синтетический, реальные отправки людям
 * здесь не выполняются.
 */
test("первая публикация доходит до обоих каналов через реальные RabbitMQ и PostgreSQL", async () => {
  const topology = localNotificationTopology("inside-test", 100);
  const broker = await new GenericContainer(NOTIFICATION_BROKER_IMAGE)
    .withExposedPorts(5672)
    .withCopyContentToContainer([
      { content: JSON.stringify(topology), target: "/etc/rabbitmq/definitions.json" },
      {
        content:
          "definitions.import_backend = local_filesystem\ndefinitions.local.path = /etc/rabbitmq/definitions.json\n",
        target: "/etc/rabbitmq/rabbitmq.conf",
      },
    ])
    .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
    .start();
  onTestFinished(async () => {
    await broker.stop();
  });
  const admin = brokerAdmin(broker);
  const database = await createMigratedTestDatabase();
  onTestFinished(() => database.dispose());
  const url = (principal: string) =>
    `amqp://local-${principal}:inside-local-only@${broker.getHost()}:${broker.getMappedPort(5672)}/inside-test`;
  const urls = {
    billing: url("billing"),
    materials: url("materials"),
    notifications: url("notifications"),
    email: url("email"),
  };

  const protection = billingContactProtection(Buffer.alloc(32, 64).toString("base64"));
  const reader = randomUUID();
  const quiet = randomUUID();
  for (const id of [ownerId, reader, quiet]) {
    await database.prisma.account.create({
      data: { id, logtoIssuer: "https://identity.example.test", logtoSubject: id },
    });
  }
  await database.prisma.billingContact.create({
    data: {
      accountId: reader,
      revision: 1,
      emailCiphertext: protection.seal(reader, "novye-materialy@example.test"),
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await database.prisma.telegramAccountLinkState.create({
    data: {
      accountId: reader,
      linkRef: randomUUID(),
      revision: 1,
      principalRef: `principal-${reader}`,
      identityRef: `identity-${reader}`,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await database.prisma.topic.create({
    data: { id: topicId, slug: "engineering", name: "Engineering" },
  });

  const { authoring, contentAccess } = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: (account: string) => account === ownerId },
  });
  const announcements = new MaterialAnnouncements({ prisma: database.prisma });
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "synthetic-material-fingerprint-0000",
  });
  const contacts = new NotificationAccounts(database.prisma, protection);
  const links = new TelegramAccountLinks(database.prisma);
  const assemble = (now: () => Date) =>
    new Notifications(
      {
        prisma: database.prisma,
        origin,
        now,
        sources: {
          resolve: (event) => announcements.resolveAnnouncement(event),
          canRead: async (account, sourceRef) => {
            const decision = await contentAccess.authorize({
              subject: { kind: "account", accountId: checkedAccountId(account) },
              resource: { kind: "material", materialId: checkedMaterialId(sourceRef) },
              action: "read",
              enforcementPoint: "published_material_read",
              correlationId: "notifications",
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
            return link.binding?.telegramIdentityRef && link.binding.accountRef
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

  // Каналы включены до публикации: доказать opt-in можно только историей, которая ей предшествует.
  const beforePublication = assemble(
    distinctClock(() => Date.parse("2026-01-02T00:00:00.000Z")),
  );
  expect(
    await beforePublication.changePreferences(reader, {
      operationId: randomUUID(),
      expectedRevision: 0,
      email: true,
      telegram: true,
    }),
  ).toMatchObject({ ok: true });

  // Команда доставки, собранная из двух чтений часов, живёт дольше, чем принимает её потребитель.
  const application = assemble(distinctClock());
  const sent: { subject: string; text: string; email: string }[] = [];
  const worker = assembleNotificationWorker({
    config: { urls, prefetch: 2, quarantineCapacity: 100 },
    transport: application.transport,
    billing: assembleBillingNotificationOutbox(database.prisma),
    materials: assembleMaterialsNotificationOutbox(database.prisma),
    processInbox: () =>
      application.sweep((message) => {
        sent.push(message);
        return Promise.resolve({ state: "sent" });
      }),
    report: () => undefined,
  });

  const draft = value(
    await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: randomUUID(),
      metadata: {
        title: "Как мы собираем платформу",
        summary: "Разбор того, из чего собрана платформа Inside.",
        access: "free",
        topicId,
        formatId: "guide",
        tagIds: [],
        seriesIds: [],
      },
      body: representativeDocument("Тело материала."),
    }),
  );
  const published = value(
    await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: randomUUID(),
      materialId: draft.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: {
        title: "Как мы собираем платформу",
        summary: "Разбор того, из чего собрана платформа Inside.",
        access: "free",
        topicId,
        formatId: "guide",
        tagIds: [],
        seriesIds: [],
      },
      body: representativeDocument("Тело материала."),
    }),
  );
  expect(published.publicationState).toBe("published");

  await worker.start();
  try {
    await eventually(async () => {
      expect(
        await database.prisma.notificationQuarantine.findMany({
          select: { lane: true, reason: true },
        }),
      ).toEqual([]);
      expect(
        await database.prisma.notificationEmailEffect.count({ where: { state: "sent" } }),
      ).toBe(1);
    }, barrierBudgetMs);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      subject: "Новый материал в Inside",
      email: "novye-materialy@example.test",
    });
    expect(sent[0]?.text).toContain("Как мы собираем платформу");
    expect(sent[0]?.text).toContain(
      `${origin}/materials/kak-my-sobiraem-platformu`,
    );

    // Событие покинуло outbox Materials только после подтверждения брокера, а команда Telegram
    // ждёт своего приложения в собственной очереди.
    await eventually(async () => {
      expect(
        await database.prisma.materialNotificationOutbox.count({
          where: { publishedAt: null },
        }),
      ).toBe(0);
      expect(await queueDepth(admin, "inside-test", lanes.telegramMaterial.queue)).toBe(1);
      expect(
        await database.prisma.notificationDelivery.count({
          where: { channel: "email", state: "sent" },
        }),
      ).toBe(1);
    }, barrierBudgetMs);

    // Уведомление получил только тот, кто сам включил каналы: подписка на новые материалы opt-in.
    expect(
      await database.prisma.notification.findMany({ select: { accountId: true, kind: true } }),
    ).toEqual([{ accountId: reader, kind: "material.published" }]);
  } finally {
    await worker.stop();
  }
}, 120_000);
