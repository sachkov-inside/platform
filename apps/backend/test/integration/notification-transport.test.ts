import { fork, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { ChannelModel } from 'amqplib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import fixtures from '../../../../docs/contracts/notifications-v1/fixtures.json' with { type: 'json' };
import { brokerAdmin, queueConsumers, queueDepth, queueLimit } from './setup/broker.js';
import { eventually } from './setup/eventually.js';
import { crashWorkerSignals, type CrashWorkerSignal } from './setup/crash-worker-protocol.js';
import { createMigratedTestDatabase, type TestDatabase } from './setup/test-database.js';
import { localNotificationTopology, NOTIFICATION_BROKER_IMAGE } from '../../src/infrastructure/notification-transport/topology.js';
import { connectNotificationBroker, consumeNotificationLane, publishNotification } from '../../src/infrastructure/notification-transport/rabbitmq.js';
import { runWorker, WORKER_READINESS_PATH } from '../../src/infrastructure/worker-runtime.js';
import { migrateRuntimeDatabase } from '../../src/migrations/migrate.js';
import { OperationalReadiness } from '../../src/infrastructure/operational-readiness.js';
import { assembleNotificationWorker } from "../../src/infrastructure/notification-transport/worker.js";
import { assembleNotificationOutbox, stageNotification } from '../../src/infrastructure/notification-transport/outbox.js';
import { encodeNotification, lanes } from '../../src/infrastructure/notification-transport/wire.js';
import { stageBillingNotification } from '../../src/modules/billing/facets/notification-outbox/notification-outbox.js';
import { stageMaterialsNotification } from '../../src/modules/materials/facets/notification-outbox/notification-outbox.js';
import { assembleNotificationTransport } from '../../src/modules/notifications/index.js';

const billingFixture = fixtures.find(f => f.valid && f.definition === 'billingEvent')?.value;
const materialFixture = fixtures.find(f => f.valid && f.definition === 'materialEvent')?.value;
function event() { return { ...billingFixture, messageId: randomUUID() }; }
// Every wait below ends on a committed fact; the budget only bounds a stuck run.
const barrierBudgetMs = 15_000;
/**
 * Запуск аварийного воркера — загрузка tsx, инициализация Prisma и TLS-рукопожатие с брокером. Эта
 * длительность принадлежит машине, а не транспорту, поэтому она вынесена из бюджета поведения.
 * Измерено на этом наборе: 0.8–1.0 с, когда файл идёт один, и 1.2–4.7 с, когда параллельно идёт
 * весь набор. Бюджет — шестикратный запас к худшему наблюдённому запуску: он не измеряет поведение
 * и останавливает только воркер, который не стартовал вовсе. Смерть процесса бюджета не ждёт.
 */
const crashWorkerStartBudgetMs = 30_000;
/**
 * Внешний срок сценария обязан превышать сумму его собственных бюджетов, иначе при зависании
 * побеждает он, а не то ожидание, которое знает причину, — и падение снова остаётся безымянным.
 * Самая длинная фаза `before-confirm` проходит пять барьеров: поведение, глубина очереди под
 * задержанным подтверждением, снятие подписки убитого воркера, запись в inbox и опустошение
 * очереди. Плюс запуск воркера. Потолок растёт не ради запаса, а потому что появился ещё один
 * барьер на факт: если сумма барьеров превысит потолок, при зависании снова победит он, и падение
 * снова останется безымянным.
 */
const crashScenarioTimeoutMs = crashWorkerStartBudgetMs + barrierBudgetMs * 5 + 5_000;
/** Вместимость очереди стенда: на ней проверяется отказ по переполнению. */
const queueCapacity = 2;
/**
 * Наблюдение за аварийным воркером. Сообщения запоминаются с момента запуска, поэтому ожидание не
 * может разминуться с уже пришедшим. Ожидание кончается фактом: названным сообщением или смертью
 * процесса. Смерть объявляется по `close`, а не по `exit`: `exit` приходит раньше, чем закрыты
 * потоки, и сообщение о падении осталось бы без stderr там, где он есть. Бюджет остаётся только на
 * третий случай — воркер жив и молчит.
 */
function watchCrashWorker(child: ChildProcess) {
  const reached = new Set<string>();
  let wake: (() => void) | undefined;
  let stderr = '';
  let departure: string | undefined;
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  child.on('message', message => {
    if (typeof message !== 'string') return;
    reached.add(message);
    wake?.();
  });
  child.once('close', (code, signal) => {
    departure = `closed (code ${String(code)}, signal ${String(signal)})`;
    wake?.();
  });
  const detail = () => stderr.trim() || 'no stderr output';
  return {
    async reaches(awaited: CrashWorkerSignal, budgetMs: number): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const settle = () => {
          clearTimeout(timer);
          wake = undefined;
          if (reached.has(awaited)) resolve();
          else if (departure !== undefined) reject(new Error(`Crash worker ${departure} before ${awaited}: ${detail()}`));
          else reject(new Error(`Crash worker is alive but did not reach ${awaited} within ${String(budgetMs)}ms: ${detail()}`));
        };
        const timer = setTimeout(settle, budgetMs);
        wake = settle;
        if (reached.has(awaited) || departure !== undefined) settle();
      });
    },
  };
}

describe('Notifications real PostgreSQL / RabbitMQ transport', () => {
  let broker: StartedTestContainer;
  let directory: string;
  let caFile: string;
  let database: TestDatabase;
  let host: string;
  const connections: ChannelModel[] = [];
  const confirmedBeforeOutage: string[] = [];
  const config = (principal: string, vhost = 'inside-test') => ({ url: `amqps://local-${principal}:inside-local-only@${host}/${vhost}?heartbeat=5`, caFile });
  async function connect(principal: string) { const connection = await connectNotificationBroker(config(principal)); connections.push(connection); return connection; }
  const admin = (args: string[]) => brokerAdmin(broker)(args);
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'platform-435-'));
    caFile = join(directory, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', join(directory, 'key.pem'), '-out', caFile], { stdio: 'ignore' });
    const topology = localNotificationTopology('inside-test', queueCapacity);
    topology.vhosts.push({ name: 'another-environment' });
    broker = await new GenericContainer(NOTIFICATION_BROKER_IMAGE)
      .withExposedPorts(5671)
      .withCopyContentToContainer([
        { content: JSON.stringify(topology), target: '/etc/rabbitmq/definitions.json' },
        { content: await readFile(caFile, 'utf8'), target: '/tmp/cert.pem' },
        { content: await readFile(join(directory, 'key.pem'), 'utf8'), target: '/tmp/key.pem' },
        { content: 'listeners.tcp = none\nlisteners.ssl.default = 5671\nssl_options.certfile = /tmp/cert.pem\nssl_options.keyfile = /tmp/key.pem\nssl_options.cacertfile = /tmp/cert.pem\nssl_options.verify = verify_none\nssl_options.fail_if_no_peer_cert = false\ndefinitions.import_backend = local_filesystem\ndefinitions.local.path = /etc/rabbitmq/definitions.json\n', target: '/etc/rabbitmq/rabbitmq.conf' },
      ]).withWaitStrategy(Wait.forLogMessage(/Server startup complete/)).withStartupTimeout(120_000).start();
    host = `${broker.getHost()}:${broker.getMappedPort(5671)}`;
    database = await createMigratedTestDatabase();
  }, 180_000);
  afterAll(async () => {
    await Promise.allSettled(connections.map(connection => connection.close()));
    await database?.dispose();
    await broker?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 60_000);

  test('TLS trust, environment isolation, publish/read/configure ACLs and bounded quorum topology', async () => {
    await expect(connectNotificationBroker({ url: config('billing').url })).rejects.toThrow();
    await expect(connectNotificationBroker(config('billing', 'another-environment'))).rejects.toThrow();
    const telegram = await connect('telegram');
    await expect(publishNotification(telegram, encodeNotification('billing', event()))).rejects.toThrow();
    const billing = await connect('billing');
    const channel = await billing.createChannel(); channel.on('error', () => undefined);
    await expect(channel.assertQueue('unauthorized')).rejects.toThrow();
    const other = await billing.createChannel(); other.on('error', () => undefined);
    await expect(other.consume(lanes.billing.queue, () => undefined)).rejects.toThrow();
    const rows = z.array(z.object({ name: z.string(), arguments: z.array(z.tuple([z.string(), z.string(), z.unknown()])).transform(entries => Object.fromEntries(entries.map(([key, _type, value]) => [key, value]))) })).parse(JSON.parse(await admin(['list_queues', '-p', 'inside-test', 'name', 'arguments', '--formatter', 'json'])));
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(row.arguments).toMatchObject({ 'x-queue-type': 'quorum', 'x-overflow': 'reject-publish', 'x-delivery-limit': -1, 'x-max-length': 2 });
  }, 30_000);

  test('source transaction rollback, immutable replay and concurrent inbox admission', async () => {
    const payload = event();
    await expect(database.prisma.$transaction(async tx => { await stageBillingNotification(tx, payload); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await database.prisma.billingNotificationOutbox.count()).toBe(0);
    await database.prisma.$transaction(async tx => { await stageBillingNotification(tx, payload); });
    await database.prisma.$transaction(async tx => { await stageBillingNotification(tx, payload); });
    await expect(database.prisma.$transaction(async tx => { await stageBillingNotification(tx, { ...payload, sourceRevision: 99 }); })).rejects.toThrow('notification_operation_conflict');
    expect(await database.prisma.billingNotificationOutbox.count()).toBe(1);
    await expect(database.prisma.$transaction(async tx => { await stageMaterialsNotification(tx, { ...materialFixture, messageId: randomUUID() }); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await database.prisma.materialNotificationOutbox.count()).toBe(0);
    const transport = assembleNotificationTransport(database.prisma, 100);
    const results = await Promise.all(Array.from({ length: 8 }, () => transport.accept(encodeNotification('billing', payload))));
    expect(results.filter(result => result === 'accepted')).toHaveLength(1);
    expect(results.filter(result => result === 'duplicate')).toHaveLength(7);
    expect(await transport.accept(encodeNotification('billing', { ...payload, sourceRevision: 99 }))).toBe('conflict');
    await database.prisma.billingNotificationOutbox.deleteMany();
    await database.prisma.notificationInbox.deleteMany();
  });

  for (const phase of ['before-confirm', 'after-confirm', 'before-inbox', 'after-inbox', 'after-ack']) {
    test(`SIGKILL ${phase}: restart retains one durable pending job`, async () => {
      const payload = event();
      const envelope = encodeNotification('billing', payload);
      const producer = await connect('billing');
      if (phase.includes('confirm')) await stageBillingNotification(database.prisma, payload);
      else await publishNotification(producer, envelope);
      const child = fork(new URL('./fixtures/notification-crash-worker.ts', import.meta.url), [], {
        execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, CRASH_CONFIG: JSON.stringify({ ...config(phase.includes('confirm') ? 'billing' : 'notifications'), databaseUrl: database.url, phase }) },
      });
      const worker = watchCrashWorker(child);
      try {
        // Запуск и проверяемое поведение ждут раздельно: первое зависит от машины, второе — нет.
        await worker.reaches(crashWorkerSignals.ready, crashWorkerStartBudgetMs);
        await worker.reaches(crashWorkerSignals.boundary, barrierBudgetMs);
        if (phase === 'before-confirm') {
          // Broker persistence is observed while the application is still denied its confirm.
          // Проверка живёт вне ожидания воркера: её провал должен называться своим именем.
          await eventually(async () => { expect(await queueDepth(admin, 'inside-test', lanes.billing.queue)).toBe(1); }, barrierBudgetMs);
        }
      } finally { child.kill('SIGKILL'); await once(child, 'exit'); }
      // Мёртвый процесс не отписывается от очереди: подписку снимает брокер, заметив пропущенные
      // heartbeat. Пока он этого не сделал, очередь отдаёт сообщения мёртвому потребителю — и
      // следующий сценарий ждёт своего сообщения, которое ушло в никуда, а сценарий насыщения
      // видит очередь, которая не наполняется. Ждём факт: подписок на очереди не осталось.
      await eventually(async () => {
        expect(await queueConsumers(admin, 'inside-test', lanes.billing.queue),
          'брокер всё ещё держит подписку убитого воркера').toBe(0);
      }, barrierBudgetMs);
      if (phase.includes('confirm')) {
        expect(await database.prisma.billingNotificationOutbox.findUniqueOrThrow({ where: { scope_messageId: { scope: 'billing', messageId: envelope.messageId } } })).toMatchObject({ publishedAt: null });
        await assembleNotificationOutbox(database.prisma.billingNotificationOutbox, ['billing']).relay('billing', message => publishNotification(producer, message));
      }
      const transport = assembleNotificationTransport(database.prisma, 100);
      const consumer = await consumeNotificationLane(await connect('notifications'), 'billing', transport, 1);
      await eventually(async () => {
        expect(await database.prisma.notificationInbox.findUnique({ where: { scope_messageId: { scope: 'billing', messageId: envelope.messageId } } })).toMatchObject({ payload: envelope.payload, completedAt: null, checkpoint: {} });
      }, barrierBudgetMs);
      // Wait for both confirm-window copies to be consumed before moving to the next crash phase.
      await eventually(async () => { expect(await queueDepth(admin, 'inside-test', lanes.billing.queue)).toBe(0); }, barrierBudgetMs);
      await consumer.stop();
      expect(await database.prisma.notificationInbox.count({ where: { messageId: envelope.messageId } })).toBe(1);
    }, crashScenarioTimeoutMs);
  }

  test('mandatory return and queue saturation preserve unpublished outbox; other lanes advance', async () => {
    const producer = await connect('materials');
    const materialEvent = { ...materialFixture, messageId: randomUUID() };
    await stageMaterialsNotification(database.prisma, materialEvent);
    // Temporarily remove the binding via a deployment authority, not a runtime principal.
    await admin(['delete_queue', '-p', 'inside-test', lanes.materials.queue]);
    const relay = assembleNotificationOutbox(database.prisma.materialNotificationOutbox, ['materials']);
    await expect(relay.relay('materials', message => publishNotification(producer, message))).rejects.toThrow('publisher_return');
    expect(await database.prisma.materialNotificationOutbox.findFirst()).toMatchObject({ publishedAt: null, attempts: 1 });
    await admin(['import_definitions', '/etc/rabbitmq/definitions.json']);
    const billing = await connect('billing');
    // Насыщение имеет смысл только на очереди, которую никто не разбирает: живой потребитель
    // уносит публикации, очередь не доходит до предела, и отказа не наступает вовсе. Это и было
    // причиной «accepted 10 publishes without rejecting»: подписка убитого воркера предыдущего
    // сценария ещё жила. Ждём факт, а не предполагаем его.
    await eventually(async () => {
      expect(await queueConsumers(admin, 'inside-test', lanes.billing.queue),
        'очередь разбирает кто-то ещё, насыщения не будет').toBe(0);
    }, barrierBudgetMs);
    // `import_definitions` возвращается раньше, чем очередь снова существует со своим пределом.
    // До этого момента брокер принимает всё, и прежний тест публиковал вслепую, утверждая то,
    // чего не контролировал: на медленной машине предел не успевал появиться, все публикации
    // проходили, и падало `expected false to be true`. Ждём факт — предел объявлен очередью.
    await eventually(async () => {
      expect(await queueLimit(admin, 'inside-test', lanes.billing.queue)).toBe(queueCapacity);
    }, barrierBudgetMs);
    // Предел очереди брокер применяет не мгновенно: несколько публикаций сверх него он ещё
    // принимает. Поэтому публикуем до отказа, но ограничиваем это счётом, выведенным из предела,
    // а не временем: сколько бы ни занимало подтверждение, число попыток остаётся тем же, и тест
    // не превращается в измерение машины. Прежние восемь попыток были догадкой и на медленной
    // машине заканчивались до отказа — отсюда `expected false to be true`.
    const saturationAttempts = queueCapacity * 5;
    let rejection: Error | undefined;
    let rejectedMessageId = '';
    for (let attempt = 0; attempt < saturationAttempts && rejection === undefined; attempt++) {
      const payload = event();
      await stageBillingNotification(database.prisma, payload);
      try {
        const published = await assembleNotificationOutbox(database.prisma.billingNotificationOutbox, ['billing'])
          .relay('billing', message => publishNotification(billing, message));
        expect(published, 'staged billing notification was not picked up by its own relay').toBe(true);
        confirmedBeforeOutage.push(payload.messageId);
      } catch (error) {
        rejection = error instanceof Error ? error : new Error(String(error));
        rejectedMessageId = payload.messageId;
      }
    }
    // Причина отказа названа: переполнение — это nack, а не возврат, не обрыв канала и не таймаут.
    expect(rejection?.message, `queue declared with x-max-length ${String(queueCapacity)} accepted ${String(saturationAttempts)} publishes without rejecting`).toBe('publisher_nack');
    expect(await database.prisma.billingNotificationOutbox.findUniqueOrThrow({ where: { scope_messageId: { scope: 'billing', messageId: rejectedMessageId } } }))
      .toMatchObject({ publishedAt: null, attempts: 1, lastFailure: 'publish_not_confirmed' });
    await publishNotification(producer, encodeNotification('materials', { ...materialFixture, messageId: randomUUID() }));
    const transport = assembleNotificationTransport(database.prisma, 100);
    const consumer = await consumeNotificationLane(await connect('notifications'), 'materials', transport, 1);
    await eventually(async () => { expect(await database.prisma.notificationInbox.count({ where: { lane: 'materials' } })).toBeGreaterThan(0); }, barrierBudgetMs);
    await consumer.stop();
  }, 45_000);

  test('poison evidence commits before ack; full quarantine stops reception without dropping the next message', async () => {
    const producer = await connect('email');
    const channel = await producer.createConfirmChannel(); channel.on('error', () => undefined);
    const publishPoison = (bytes: string) => new Promise<void>((resolve, reject) => channel.publish(lanes.emailResult.exchange, lanes.emailResult.key, Buffer.from(bytes), { persistent: true, mandatory: true, contentType: 'application/json', type: lanes.emailResult.version, messageId: randomUUID() }, error => error ? reject(new Error('publish failed')) : resolve()));
    const transport = assembleNotificationTransport(database.prisma, 1);
    const consumer = await consumeNotificationLane(await connect('notifications'), 'emailResult', transport, 1);
    await publishPoison('{broken:1');
    await eventually(async () => { expect(await database.prisma.notificationQuarantine.count()).toBe(1); }, barrierBudgetMs);
    await publishPoison('{broken:2');
    await expect(consumer.failed).rejects.toThrow('notification_receipt_unavailable');
    await consumer.stop();
    await database.prisma.notificationQuarantine.updateMany({ data: { payloadExpiresAt: new Date(0) } });
    await transport.observe();
    expect(await database.prisma.notificationQuarantine.findFirst()).toMatchObject({ payload: null });
    const recovered = await consumeNotificationLane(await connect('notifications'), 'emailResult', transport, 1);
    await eventually(async () => { expect(await database.prisma.notificationQuarantine.count()).toBe(2); }, barrierBudgetMs);
    await recovered.stop();
  }, 30_000);

  test('broker node outage retains queue data and PostgreSQL work across restart (singleton, not HA)', async () => {
    await admin(['stop_app']);
    await stageMaterialsNotification(database.prisma, { ...materialFixture, messageId: randomUUID() });
    expect(await database.prisma.materialNotificationOutbox.count({ where: { publishedAt: null } })).toBeGreaterThan(0);
    await admin(['start_app']);
    const producer = await connect('materials');
    await database.prisma.materialNotificationOutbox.updateMany({ data: { nextAttemptAt: new Date(0) } });
    const transport = assembleNotificationTransport(database.prisma, 100);
    const receiver = await consumeNotificationLane(await connect('notifications'), 'materials', transport, 1);
    const relay = assembleNotificationOutbox(database.prisma.materialNotificationOutbox, ['materials']);
    while (await relay.relay('materials', message => publishNotification(producer, message))) { /* bounded test fixture backlog */ }
    await eventually(async () => { expect(await database.prisma.notificationInbox.count({ where: { lane: 'materials' } })).toBeGreaterThan(1); }, barrierBudgetMs);
    await receiver.stop();
    const billingReceiver = await consumeNotificationLane(await connect('notifications'), 'billing', transport, 1);
    await eventually(async () => {
      for (const messageId of confirmedBeforeOutage) expect(await database.prisma.notificationInbox.findUnique({ where: { scope_messageId: { scope: 'billing', messageId } } })).not.toBeNull();
    }, barrierBudgetMs);
    await billingReceiver.stop();
  }, 45_000);
  test('composed worker relays both sources and email/results, drains and reports broker failure', async () => {
    await migrateRuntimeDatabase(database.url);
    const transport = assembleNotificationTransport(database.prisma, 100);
    const observed: Record<string, unknown>[] = [];
    const worker = assembleNotificationWorker({
      config: { urls: { billing: config('billing').url, materials: config('materials').url, notifications: config('notifications').url, email: config('email').url }, caFile, prefetch: 1, quarantineCapacity: 100 },
      transport, billing: assembleNotificationOutbox(database.prisma.billingNotificationOutbox, ['billing']),
      materials: assembleNotificationOutbox(database.prisma.materialNotificationOutbox, ['materials']), report: event => observed.push(event),
    });
    const billing = event();
    const material = { ...materialFixture, messageId: randomUUID() };
    const email = { ...fixtures.find(f => f.valid && f.definition === 'emailDelivery')?.value, operationId: randomUUID() };
    const result = { ...fixtures.find(f => f.valid && f.definition === 'sentResult')?.value, channel: 'email', messageId: randomUUID() };
    await stageBillingNotification(database.prisma, billing);
    await stageMaterialsNotification(database.prisma, material);
    await stageNotification(database.prisma.notificationOutbox, 'emailMaterial', email);
    await stageNotification(database.prisma.notificationOutbox, 'emailResult', result);
    const running = runWorker({
      application: { close: () => Promise.resolve() }, databaseUrl: database.url,
      process: 'notifications-worker',
      readiness: new OperationalReadiness(database.prisma, { release: 'development', sourceSha: '0'.repeat(40) }),
      jobs: {
        start: () => worker.start(),
        async stop(options) {
          await expect(readFile(WORKER_READINESS_PATH)).rejects.toThrow();
          await worker.stop(options);
        },
      },
      failed: worker.failed, registerJobs: () => Promise.resolve(),
    });
    void running.catch(() => undefined);
    try {
      await Promise.race([running, eventually(async () => { expect(JSON.parse(await readFile(WORKER_READINESS_PATH, 'utf8'))).toMatchObject({ process: 'notifications-worker', status: 'ready' }); }, barrierBudgetMs)]);
      await eventually(async () => {
        for (const messageId of [billing.messageId, material.messageId, email.operationId, result.messageId]) {
          expect(await database.prisma.notificationInbox.count({ where: { messageId, completedAt: null } })).toBe(1);
        }
      }, barrierBudgetMs);
      expect(observed.some(event => event.status === 'transport_observation' || event.status === 'operator_attention')).toBe(true);
      await admin(['stop_app']);
      await expect(running).rejects.toThrow(/notification_broker_disconnected|notification_consumer_stopped/u);
    } finally { await worker.stop(); await admin(['start_app']); }
  }, 45_000);

});
