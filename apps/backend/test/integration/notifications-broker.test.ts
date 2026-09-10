import { randomUUID } from 'node:crypto';
import { GenericContainer, Wait } from 'testcontainers';
import { expect, test, onTestFinished } from 'vitest';
import { z } from 'zod';
import { eventually } from './setup/eventually.js';
import { createMigratedTestDatabase } from './setup/test-database.js';
import { localNotificationTopology, NOTIFICATION_BROKER_IMAGE } from '../../src/infrastructure/notification-transport/topology.js';
import { assembleNotificationWorker } from '../../src/infrastructure/notification-transport/worker.js';
import { connectNotificationBroker, publishNotification } from '../../src/infrastructure/notification-transport/rabbitmq.js';
import { encodeNotification, lanes } from '../../src/infrastructure/notification-transport/wire.js';
import { Notifications, type NotificationSource } from '../../src/modules/notifications/index.js';
import { assembleAccounts, NotificationAccounts } from '../../src/modules/accounts/index.js';
import { billingContactProtection } from '../../src/modules/accounts/infrastructure/billing-contact-protection.js';
import { assembleBillingNotificationOutbox } from '../../src/modules/billing/index.js';
import { stageBillingNotification } from '../../src/modules/billing/facets/notification-outbox/notification-outbox.js';
import { assembleMaterialsNotificationOutbox } from '../../src/modules/materials/index.js';
import { stageMaterialsNotification } from '../../src/modules/materials/facets/notification-outbox/notification-outbox.js';
import type { NotificationEvent } from '../../src/modules/notifications/domain/notification-wire.js';

// Every wait below ends on a committed fact; the budget only bounds a stuck run.
const barrierBudgetMs = 30_000;
test('real RabbitMQ event → audience → email inbox/effect → result outage/recovery; both categories and ACL', async () => {
  const topology = localNotificationTopology('inside-test', 100);
  const broker = await new GenericContainer(NOTIFICATION_BROKER_IMAGE).withExposedPorts(5672).withCopyContentToContainer([
    { content: JSON.stringify(topology), target: '/etc/rabbitmq/definitions.json' },
    { content: 'definitions.import_backend = local_filesystem\ndefinitions.local.path = /etc/rabbitmq/definitions.json\n', target: '/etc/rabbitmq/rabbitmq.conf' },
  ]).withWaitStrategy(Wait.forLogMessage(/Server startup complete/)).start();
  onTestFinished(async () => { await broker.stop(); });
  const database = await createMigratedTestDatabase();
  onTestFinished(() => database.dispose());
  const url = (principal: string) => `amqp://local-${principal}:inside-local-only@${broker.getHost()}:${broker.getMappedPort(5672)}/inside-test`;
  const urls = { billing: url('billing'), materials: url('materials'), notifications: url('notifications'), email: url('email') };
  const actor = randomUUID();
  const instant = new Date();
  const before = new Date(instant.getTime() - 60_000);
  const event = (category: 'subscription' | 'material'): NotificationEvent => ({ contractVersion: 'inside.notification-event.v1', messageId: randomUUID(), occurrenceRef: randomUUID(), sourceRef: randomUUID(),
    sourceRevision: 1, eventType: category === 'subscription' ? 'billing.notice-ready' : 'material.published', occurredAt: instant.toISOString(),
    notAfter: new Date(instant.getTime() + (category === 'material' ? 86_400_000 : 3_600_000)).toISOString(), ...(category === 'subscription' ? { accountRef: actor, kind: 'payment_succeeded' } : {}) });
  const billing = event('subscription'); const material = event('material');
  const protection = billingContactProtection(Buffer.alloc(32, 44).toString('base64'));
  await database.prisma.account.create({ data: { id: actor, logtoIssuer: 'https://identity.example.test', logtoSubject: actor, createdAt: before } });
  await database.prisma.billingContact.create({ data: { accountId: actor, revision: 1, verifiedAt: before, emailCiphertext: protection.seal(actor, 'broker-proof@example.test') } });
  const contacts = new NotificationAccounts(database.prisma, protection);
  const source = (candidate: NotificationEvent): NotificationSource => ({ status: 'current', event: candidate,
    accountId: candidate.eventType === 'material.published' ? null : actor,
    content: candidate.eventType === 'material.published' ? { category: 'material', kind: 'material_published' } : { category: 'subscription', kind: 'payment_succeeded' },
    title: 'Synthetic source for real transport proof', readerPath: '/materials/broker-proof' });
  // Wall time that never answers twice in the same millisecond. Two reads landing inside one
  // millisecond is luck, and a delivery command assembled from two reads outlives what its own
  // consumer accepts, so this clock makes that dependency fail here instead of at random on CI.
  let lastRead = 0;
  const now = () => { const reading = Math.max(Date.now(), lastRead + 1); lastRead = reading; return new Date(reading); };
  const app = new Notifications({ prisma: database.prisma, origin: 'https://inside.example.test', now,
    sources: { resolve: candidate => Promise.resolve([billing.occurrenceRef, material.occurrenceRef].includes(candidate.occurrenceRef) ? source(candidate) : { status: 'unavailable' }), canRead: () => Promise.resolve('allowed') },
    recipients: { exists: id => contacts.exists(id), enumerate: query => contacts.enumerate(query), binding: (id, channel) => channel === 'email' ? contacts.binding(id) : Promise.resolve(null), email: binding => contacts.email(binding) },
  }, assembleAccounts({ prisma: database.prisma, emailFingerprintKey: 'notification-broker-fixture-key-at-least-32' }));
  // Consent predates the publication. The preference facet is independently covered against PostgreSQL.
  await database.prisma.notificationPreference.create({ data: { accountId: actor, revision: 1, email: true, telegram: false, changedAt: before } });
  await database.prisma.notificationPreferenceRevision.create({ data: { accountId: actor, revision: 1, email: true, telegram: false, changedAt: before, operationId: randomUUID(), fingerprint: 'fixture' } });
  const emailPermission = topology.permissions.find(permission => permission.user === 'local-email');
  if (!emailPermission) throw new Error('Missing email permission');
  const revoked = await broker.exec(['rabbitmqctl', 'set_permissions', '-p', 'inside-test', 'local-email', '^$', '^$', emailPermission.read]);
  expect(revoked.exitCode).toBe(0);
  let sends = 0;
  const reports: Record<string, unknown>[] = [];
  const worker = assembleNotificationWorker({ config: { urls, prefetch: 2, quarantineCapacity: 100 }, transport: app.transport,
    billing: assembleBillingNotificationOutbox(database.prisma), materials: assembleMaterialsNotificationOutbox(database.prisma),
    processInbox: () => app.sweep(() => { sends += 1; return Promise.resolve({ state: 'sent' }); }), report: event => { reports.push(event); } });
  // Counts ready and unacknowledged messages, so an empty queue proves a publish was consumed and acknowledged.
  const queued = async (queue: string) => z.array(z.object({ name: z.string(), messages: z.number() }))
    .parse(JSON.parse((await broker.exec(['rabbitmqctl', 'list_queues', '-p', 'inside-test', 'name', 'messages', '--formatter', 'json'])).output))
    .find(row => row.name === queue)?.messages;
  const invalid = await connectNotificationBroker({ url: urls.email });
  const publisher = await connectNotificationBroker({ url: urls.billing });
  try {
    await expect(publishNotification(invalid, encodeNotification('billing', billing))).rejects.toThrow();
    await database.prisma.$transaction(async transaction => { await stageBillingNotification(transaction, billing); });
    await database.prisma.$transaction(async transaction => { await stageMaterialsNotification(transaction, material); });
    await worker.start();
    // A quarantined command is lost for good, so it is read alongside the effects: the failure then
    // names the rejected lane instead of reporting one effect short after the whole budget.
    await eventually(async () => {
      expect(await database.prisma.notificationQuarantine.findMany({ select: { lane: true, reason: true } })).toEqual([]);
      expect(await database.prisma.notificationEmailEffect.count({ where: { state: 'sent' } })).toBe(2);
    }, barrierBudgetMs);
    expect(sends).toBe(2);
    // The outage is a fact, not an assumption: results stay staged because the broker refused the
    // publish, which is exactly what the revoked write permission has to produce.
    await eventually(async () => {
      expect(await database.prisma.notificationOutbox.count({ where: { scope: 'email', publishedAt: null, lastFailure: 'publish_not_confirmed' } })).toBeGreaterThanOrEqual(1);
      expect(reports).toContainEqual(expect.objectContaining({ status: 'operator_attention', reason: 'publish_not_confirmed', lane: 'emailResult' }));
    }, barrierBudgetMs);
    expect(await database.prisma.notificationDelivery.count({ where: { state: 'sent' } })).toBe(0);
    expect(await database.prisma.notificationOutbox.count({ where: { scope: 'email', publishedAt: null } })).toBeGreaterThanOrEqual(2);
    const restored = await broker.exec(['rabbitmqctl', 'set_permissions', '-p', 'inside-test', 'local-email', emailPermission.configure, emailPermission.write, emailPermission.read]);
    expect(restored.exitCode).toBe(0);
    await eventually(async () => { expect(await database.prisma.notificationDelivery.count({ where: { state: 'sent' } })).toBe(2); }, barrierBudgetMs);
    await publishNotification(publisher, encodeNotification('billing', billing));
    // A drained queue proves the republished event was consumed and acknowledged; a fixed pause here
    // would only guess how fast this machine is.
    await eventually(async () => { expect(await queued(lanes.billing.queue)).toBe(0); }, barrierBudgetMs);
    expect(sends).toBe(2);
    expect(await database.prisma.notification.count()).toBe(2);
    expect(await database.prisma.notificationEmailAttempt.count()).toBe(2);
  } finally {
    await worker.stop(); await invalid.close().catch(() => undefined); await publisher.close().catch(() => undefined);

  }
}, 90_000);
