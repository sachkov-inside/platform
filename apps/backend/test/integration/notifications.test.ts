import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PLATFORM_CONFIG, parsePlatformConfig } from '../../src/config/platform-config.js';
import { NotificationDispatchController } from '../../src/modules/notifications/features/authorize-dispatch/notification-dispatch.controller.js';
import { ProblemDetailsFilter } from '../../src/infrastructure/http/problem-details.filter.js';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { distinctClock } from './setup/distinct-clock.js';
import { createMigratedTestDatabase, type TestDatabase } from './setup/test-database.js';
import { Notifications, type NotificationDependencies, type NotificationSource } from '../../src/modules/notifications/index.js';
import { NotificationAccounts, assembleAccounts } from '../../src/modules/accounts/index.js';
import { BillingContact } from '../../src/modules/accounts/facets/billing-contact/billing-contact.js';
import { billingContactProtection } from '../../src/modules/accounts/infrastructure/billing-contact-protection.js';
import { encodeNotification } from '../../src/infrastructure/notification-transport/wire.js';
import { expandAudience, type QuarantineNotification } from '../../src/modules/notifications/features/expand-audience/expand-audience.js';
import { dispatchEmail, acceptEmailCommand } from '../../src/modules/notifications/features/dispatch-email/dispatch-email.js';
import { refreshDeliveries } from '../../src/modules/notifications/features/expand-audience/refresh-deliveries.js';
import { deliverySchema, resultSchema, COMMAND_LIFETIME_MS, type NotificationEvent, type DeliveryCommand, type AuthorizeRequest } from '../../src/modules/notifications/domain/notification-wire.js';
import { renderNotification } from '../../src/modules/notifications/domain/templates.js';
const protection = billingContactProtection(Buffer.alloc(32, 43).toString('base64'));
const standOrigin = 'https://inside.example.test';
/** Карантин здесь никого не ждёт: строки этих сценариев обрабатываются, а не отравляют разбор. */
const quarantined: QuarantineNotification = () => Promise.resolve();

describe('Notifications persistence and delivery (real PostgreSQL; synthetic source/provider facts)', () => {
  let database: TestDatabase;
  beforeAll(async () => { database = await createMigratedTestDatabase(); });
  afterAll(async () => database.dispose());
  async function scenario(category: 'subscription' | 'material' = 'subscription') {
    let instant = new Date('2026-09-08T12:00:00.000Z');
    const now = () => instant;
    const contacts = new NotificationAccounts(database.prisma, protection);
    const actor = randomUUID();
    await database.prisma.account.create({ data: { id: actor, logtoIssuer: 'https://identity.example.test', logtoSubject: actor, createdAt: new Date(instant.getTime() - 60_000) } });
    let sentCode = '';
    const billing = new BillingContact({ prisma: database.prisma, protection, now, documents: [], sendCode: message => { sentCode = message.code; return Promise.resolve(); } });
    const verify = async (revision = 0) => {
      const started = await billing.start(actor, { operationId: randomUUID(), expectedRevision: revision, email: `member-${revision}-${actor}@example.test` });
      if (!started.ok) throw new Error(started.error.code);
      expect(await billing.confirm(actor, { operationId: randomUUID(), challengeRef: started.challengeRef, code: sentCode })).toEqual({ ok: true, revision: revision + 1 });
    };
    await verify();
    const event: NotificationEvent = { contractVersion: 'inside.notification-event.v1', messageId: randomUUID(), occurrenceRef: randomUUID(), sourceRef: randomUUID(), sourceRevision: 1,
      occurredAt: new Date(instant.getTime() + 10_000).toISOString(), notAfter: new Date(instant.getTime() + 10_000 + (category === 'material' ? 86_400_000 : 3_600_000)).toISOString(),
      eventType: category === 'material' ? 'material.published' : 'billing.notice-ready', ...(category === 'subscription' ? { accountRef: actor, kind: 'payment_succeeded' } : {}) };
    const fact: NotificationSource = { status: 'current', event, content: category === 'material' ? { category, kind: 'material_published' } : { category, kind: 'payment_succeeded' },
      accountId: category === 'material' ? null : actor, title: 'Проверяемое сообщение', readerPath: '/materials/example', ...(category === 'subscription' ? { amountMinor: 200000 } : {}) };
    let source: NotificationSource = fact;
    let access: 'allowed' | 'denied' | 'unavailable' = 'allowed';
    const deps: NotificationDependencies = { prisma: database.prisma, origin: standOrigin, now,
      sources: { resolve: candidate => Promise.resolve(candidate.occurrenceRef === event.occurrenceRef ? source : { status: 'unavailable' }), canRead: () => Promise.resolve(access) },
      recipients: { exists: id => contacts.exists(id), enumerate: query => contacts.enumerate(query), binding: (id, channel) => channel === 'email' ? contacts.binding(id) : Promise.resolve(null), email: binding => contacts.email(binding) } };
    const accounts = assembleAccounts({ prisma: database.prisma, emailFingerprintKey: 'notification-test-key-long-enough' });
    const app = new Notifications(deps, accounts);
    const advance = (ms: number) => { instant = new Date(instant.getTime() + ms); };
    const publish = async () => { advance(10_000); await app.acceptEvent(encodeNotification(category === 'material' ? 'materials' : 'billing', event)); await database.prisma.notificationInbox.update({ where: { scope_messageId: { scope: category === 'material' ? 'materials' : 'billing', messageId: event.messageId } }, data: { nextAttemptAt: now() } }); await expandAudience(deps, category === 'material' ? 'materials' : 'billing', quarantined); };
    const commands = async () => database.prisma.notificationCommand.findMany({ where: { delivery: { notification: { occurrenceRef: event.occurrenceRef, accountId: actor } } }, orderBy: { revision: 'asc' } });
    const command = async () => { const row = (await commands()).at(-1); if (!row) throw new Error('Missing command'); return { row, value: deliverySchema.parse(JSON.parse(row.payload)) }; };
    const admit = async () => { const { value } = await command(); await app.acceptEvent(encodeNotification(category === 'material' ? 'emailMaterial' : 'emailSubscription', value)); return value; };
    return { actor, app, deps, event, fact, contacts, verify, advance, publish, commands, command, admit,
      source: (value: NotificationSource) => { source = value; }, access: (value: typeof access) => { access = value; } };
  }
  function request(command: DeliveryCommand, digest: string): AuthorizeRequest {
    return { contractVersion: 'inside.notification-dispatch.v1', operationId: randomUUID(), deliveryOperationId: command.operationId, deliveryRef: command.deliveryRef,
      commandRevision: command.commandRevision, payloadDigest: digest, attemptRef: randomUUID() };
  }
  async function project(app: Notifications, deliveryRef: string) {
    const effect = await database.prisma.notificationEmailEffect.findUniqueOrThrow({ where: { deliveryId: deliveryRef } });
    if (!effect.resultPayload) throw new Error('Missing result');
    const result = resultSchema.parse(JSON.parse(effect.resultPayload));
    await app.acceptDeliveryResult('email', result);
    return result;
  }
  test('preferences default off; atomic concurrent revisions, immutable replay and account isolation', async () => {
    const s = await scenario();
    expect(await s.app.readPreferences(s.actor)).toEqual({ revision: 0, email: false, telegram: false });
    const input = { operationId: randomUUID(), expectedRevision: 0, email: true, telegram: false };
    const race = await Promise.all(Array.from({ length: 8 }, () => s.app.changePreferences(s.actor, input)));
    expect(race.every(result => result.ok && result.preferences.revision === 1)).toBe(true);
    expect(await s.app.changePreferences(s.actor, { ...input, telegram: true })).toMatchObject({ ok: false, code: 'operation_conflict' });
    const competing = await Promise.all([true, false].map(email => s.app.changePreferences(s.actor, { ...input, operationId: randomUUID(), expectedRevision: 1, email })));
    expect(competing.filter(result => result.ok)).toHaveLength(1);
    expect(await s.app.readPreferences(randomUUID())).toEqual({ revision: 0, email: false, telegram: false });
    expect(await s.app.changePreferences(s.actor, { ...input, accountId: randomUUID() })).toMatchObject({ ok: false, code: 'invalid_input' });
  });
  test('billing occurrence and channel dedupe; concurrent provider workers commit started before one send', async () => {
    const s = await scenario();
    await s.publish();
    const envelope = encodeNotification('billing', s.event);
    expect(await Promise.all(Array.from({ length: 8 }, () => s.app.acceptEvent(envelope)))).toEqual(Array(8).fill('duplicate'));
    await expandAudience(s.deps, 'billing', quarantined);
    expect(await s.commands()).toHaveLength(1);
    const c = await s.admit();
    let sends = 0;
    const send = async () => {
      sends += 1;
      expect(await database.prisma.notificationEmailEffect.findUnique({ where: { deliveryId: c.deliveryRef } })).toMatchObject({ state: 'unknown' });
      return { state: 'sent' as const };
    };
    await Promise.all(Array.from({ length: 6 }, () => dispatchEmail(s.deps, send, 'subscription')));
    expect(sends).toBe(1);
    expect(await project(s.app, c.deliveryRef)).toMatchObject({ state: 'sent' });
    const restarted = new Notifications(s.deps, assembleAccounts({ prisma: database.prisma, emailFingerprintKey: 'notification-test-key-long-enough' }));
    expect(await restarted.acceptEvent(encodeNotification('emailSubscription', c))).toBe('duplicate');
    await dispatchEmail(s.deps, send, 'subscription');
    expect(sends).toBe(1);
    expect((await s.app.readDeliveries(s.actor)).find(row => row.id === c.deliveryRef)?.state).toBe('sent');
  });
  test('material audience excludes late opt-in; current opt-out and access are checked again', async () => {
    const s = await scenario('material');
    await s.app.changePreferences(s.actor, { operationId: randomUUID(), expectedRevision: 0, email: true, telegram: false });
    await s.publish();
    const c = await s.admit();
    const { row } = await s.command();
    s.access('denied');
    expect(await s.app.authorizeDispatch('email', request(c, row.digest))).toMatchObject({ status: 'denied', reason: 'access_denied' });
    s.access('allowed');
    await s.app.changePreferences(s.actor, { operationId: randomUUID(), expectedRevision: 1, email: false, telegram: false });
    expect(await s.app.authorizeDispatch('email', request(c, row.digest))).toMatchObject({ status: 'denied', reason: 'preference_disabled' });
    const late = await scenario('material');
    await late.publish();
    await late.app.changePreferences(late.actor, { operationId: randomUUID(), expectedRevision: 0, email: true, telegram: false });
    await expandAudience(late.deps, 'materials', quarantined);
    expect(await late.commands()).toHaveLength(0);
  });
  test('authorization binds channel, digest, attempt, source and contact; replay does not extend permit', async () => {
    const s = await scenario(); await s.publish();
    const { value: c, row } = await s.command(); const r = request(c, row.digest);
    expect(await s.app.authorizeDispatch('telegram', r)).toMatchObject({ status: 'denied', reason: 'not_found' });
    const allowed = await s.app.authorizeDispatch('email', r);
    expect(allowed.status).toBe('allowed');
    s.advance(6_000);
    expect(await s.app.authorizeDispatch('email', r)).toEqual(allowed);
    expect(await s.app.authorizeDispatch('email', { ...r, attemptRef: randomUUID() })).toMatchObject({ status: 'error', code: 'operation_conflict' });
    s.source({ status: 'unavailable' });
    expect(await s.app.authorizeDispatch('email', request(c, row.digest))).toMatchObject({ status: 'error', code: 'unavailable' });
    s.source({ ...s.fact, title: 'Изменённые условия' });
    expect(await s.app.authorizeDispatch('email', request(c, row.digest))).toMatchObject({ status: 'denied', reason: 'superseded' });
    s.source(s.fact); s.advance(61_000); await s.verify(1);
    expect(await s.app.authorizeDispatch('email', request(c, row.digest))).toMatchObject({ status: 'denied', reason: 'binding_conflict' });
  });
  test('unknown blocks restart/revision/recipient bypass; operator skip remains unknown with audit', async () => {
    const s = await scenario(); await s.publish(); const c = await s.admit();
    let sends = 0;
    await dispatchEmail(s.deps, () => { sends += 1; return Promise.reject(new Error('lost SMTP response')); }, 'subscription');
    const unknown = await project(s.app, c.deliveryRef);
    expect(unknown.state).toBe('unknown');
    s.advance(700_000);
    await dispatchEmail(s.deps, () => { sends += 1; return Promise.resolve({ state: 'sent' }); }, 'subscription');
    expect(sends).toBe(1);
    expect(await acceptEmailCommand(database.prisma, { ...c, operationId: randomUUID(), commandRevision: 2 }, 'emailSubscription', s.deps.now)).toBe('conflict');
    const recovery = { operationId: randomUUID(), deliveryRef: c.deliveryRef, action: 'skip' };
    expect(await s.app.resolveUnknown(s.actor, recovery)).toMatchObject({ ok: false, code: 'forbidden' });
    await database.prisma.accountPermission.create({ data: { accountId: s.actor, permission: 'platform:admin' } });
    expect(await s.app.resolveUnknown(s.actor, recovery)).toEqual({ ok: true });
    expect(await s.app.resolveUnknown(s.actor, recovery)).toEqual({ ok: true });
    expect((await s.app.readDeliveries(s.actor)).find(row => row.id === c.deliveryRef)).toMatchObject({ state: 'unknown', recoverySkipped: true });
    expect(await database.prisma.notificationRecoveryAudit.count({ where: { deliveryId: c.deliveryRef } })).toBe(1);
    // Same-attempt late success refines evidence without a new effect, even after operator skip.
    const sent = { ...unknown, messageId: randomUUID(), resultRevision: unknown.resultRevision + 1, state: 'sent', receiptRef: randomUUID() };
    delete sent.reason;
    expect(await s.app.acceptDeliveryResult('email', sent)).toBe('accepted');
  });
  test('explicit not-sent rejection retries with new attempt and fresh permit, same command', async () => {
    const s = await scenario(); await s.publish(); const c = await s.admit();
    await dispatchEmail(s.deps, () => Promise.resolve({ state: 'not_sent', retryAfterMs: 5_000 }), 'subscription');
    const retry = await project(s.app, c.deliveryRef); expect(retry.state).toBe('retrying');
    s.advance(5_000);
    await dispatchEmail(s.deps, () => Promise.resolve({ state: 'sent' }), 'subscription');
    const sent = await project(s.app, c.deliveryRef); expect(sent.state).toBe('sent'); expect(sent.attemptRef).not.toBe(retry.attemptRef);
    expect(await database.prisma.notificationEmailAttempt.count({ where: { deliveryId: c.deliveryRef } })).toBe(2);
    expect(await s.commands()).toHaveLength(1);
  });
  test('expired command is suppressed without I/O and may get a new immutable revision only after proof', async () => {
    const s = await scenario(); await s.publish(); const c = await s.admit();
    s.advance(600_001);
    let sends = 0;
    await dispatchEmail(s.deps, () => { sends += 1; return Promise.resolve({ state: 'sent' }); }, 'subscription');
    expect((await project(s.app, c.deliveryRef)).state).toBe('suppressed'); expect(sends).toBe(0);
    // The replacement command is issued against a clock that moves: its window has to stay inside the
    // lifetime its own consumer accepts, or the command is quarantined instead of delivered.
    await refreshDeliveries({ ...s.deps, now: distinctClock(() => s.deps.now().getTime()) }); expect(await s.commands()).toHaveLength(2);
    const next = await s.admit(); expect(next.commandRevision).toBe(2); expect(next.deliveryRef).toBe(c.deliveryRef);
    expect(Date.parse(next.notAfter) - Date.parse(next.issuedAt)).toBeLessThanOrEqual(COMMAND_LIFETIME_MS);
    await dispatchEmail(s.deps, () => { sends += 1; return Promise.resolve({ state: 'sent' }); }, 'subscription');
    expect(sends).toBe(1); expect((await project(s.app, c.deliveryRef)).state).toBe('sent');
  });
  test('result correlation rejects foreign channel/attempt and conflicting revision, preserves late lower result', async () => {
    const s = await scenario(); await s.publish(); const c = await s.admit();
    await dispatchEmail(s.deps, () => Promise.resolve({ state: 'unknown' }), 'subscription');
    const unknown = await project(s.app, c.deliveryRef);
    expect(await s.app.acceptDeliveryResult('email', unknown)).toBe('duplicate');
    expect(await s.app.acceptDeliveryResult('email', { ...unknown, messageId: randomUUID() })).toBe('operation_conflict');
    expect(await s.app.acceptDeliveryResult('telegram', { ...unknown, channel: 'telegram', messageId: randomUUID(), resultRevision: 100 })).toBe('correlation_conflict');
    expect(await s.app.acceptDeliveryResult('email', { ...unknown, messageId: randomUUID(), resultRevision: 100, attemptRef: randomUUID() })).toBe('attempt_conflict');
    const outbox = await database.prisma.notificationOutbox.findMany({ where: { scope: 'email' } });
    const prior = outbox.map(row => resultSchema.parse(JSON.parse(row.payload))).find(row => row.deliveryRef === c.deliveryRef && row.state === 'accepted');
    expect(prior).toBeDefined();
    expect(await s.app.acceptDeliveryResult('email', prior)).toBe('stale');
  });
  test('late retrying projection cannot suppress a retry proven not_sent by the email ledger', async () => {
    const s = await scenario(); await s.publish(); const c = await s.admit();
    await dispatchEmail(s.deps, () => Promise.resolve({ state: 'not_sent', retryAfterMs: 1_000 }), 'subscription');
    const rows = await database.prisma.notificationOutbox.findMany({ where: { scope: 'email' } });
    const unknown = rows.map(row => resultSchema.parse(JSON.parse(row.payload))).find(result => result.deliveryRef === c.deliveryRef && result.state === 'unknown');
    expect(unknown).toBeDefined(); await s.app.acceptDeliveryResult('email', unknown);
    s.advance(1_000);
    let sends = 0;
    await dispatchEmail(s.deps, () => { sends += 1; return Promise.resolve({ state: 'sent' }); }, 'subscription');
    expect(sends).toBe(1);
    const effect = await database.prisma.notificationEmailEffect.findUniqueOrThrow({ where: { deliveryId: c.deliveryRef } });
    const sent = resultSchema.parse(JSON.parse(effect.resultPayload ?? 'null'));
    expect(await s.app.acceptDeliveryResult('email', sent)).toBe('deferred');
    const retrying = rows.map(row => resultSchema.parse(JSON.parse(row.payload))).find(result => result.deliveryRef === c.deliveryRef && result.state === 'retrying');
    expect(await s.app.acceptDeliveryResult('email', retrying)).toBe('accepted');
    expect(await s.app.acceptDeliveryResult('email', sent)).toBe('accepted');
    expect((await s.app.readDeliveries(s.actor)).find(row => row.id === c.deliveryRef)?.state).toBe('sent');
  });
  test('pause after started commit cannot send with an expired permit', async () => {
    const s = await scenario(); await s.publish(); const c = await s.admit();
    const pausingPrisma: NotificationDependencies['prisma'] = { ...s.deps.prisma,
      $transaction: async operation => {
        const result = await s.deps.prisma.$transaction(operation);
        const effect = await s.deps.prisma.notificationEmailEffect.findUnique({ where: { deliveryId: c.deliveryRef } });
        if (effect?.state === 'unknown') s.advance(6_000);
        return result;
      },
    };
    let sends = 0;
    await dispatchEmail({ ...s.deps, prisma: pausingPrisma }, () => { sends += 1; return Promise.resolve({ state: 'sent' }); }, 'subscription');
    expect(sends).toBe(0);
    expect(await database.prisma.notificationEmailAttempt.findFirst({ where: { deliveryId: c.deliveryRef } })).toMatchObject({ state: 'not_sent' });
  });
  test('expired source tombstones cannot starve a still-current command refresh', async () => {
    const s = await scenario(); await s.publish(); const command = await s.admit();
    s.advance(600_001);
    await dispatchEmail(s.deps, () => Promise.resolve({ state: 'sent' }), 'subscription');
    await project(s.app, command.deliveryRef);
    for (let index = 0; index < 30; index += 1) {
      const notificationId = randomUUID(); const deliveryId = randomUUID();
      const expired = { ...s.event, occurrenceRef: randomUUID(), notAfter: s.event.occurredAt };
      const copy = { ...command, notificationRef: notificationId, deliveryRef: deliveryId, operationId: randomUUID() };
      const envelope = encodeNotification('emailSubscription', copy);
      await database.prisma.notification.create({ data: { id: notificationId, kind: expired.eventType, occurrenceRef: expired.occurrenceRef, accountId: s.actor,
        eventPayload: JSON.stringify(expired), sourceRevision: 1, createdAt: s.deps.now() } });
      await database.prisma.notificationDelivery.create({ data: { id: deliveryId, notificationId, channel: 'email', commandRevision: 1, state: 'suppressed', reason: 'expired',
        nextCommandAt: new Date(s.deps.now().getTime() - 1_000), updatedAt: s.deps.now() } });
      await database.prisma.notificationCommand.create({ data: { operationId: copy.operationId, deliveryId, revision: 1, payload: envelope.payload, digest: envelope.digest.slice('sha256:'.length), createdAt: s.deps.now() } });
    }
    for (let sweep = 0; sweep < 5; sweep += 1) await refreshDeliveries(s.deps);
    expect(await s.commands()).toHaveLength(2);
    expect(await database.prisma.notificationDelivery.count({ where: { notification: { accountId: s.actor }, state: 'suppressed', nextCommandAt: null } })).toBe(30);
  });
  test('service HTTP preserves correlated JSON errors and fails closed for wrong credentials/version', async () => {
    const s = await scenario(); await s.publish(); const { value, row } = await s.command();
    const credential = 'synthetic-dedicated-telegram-secret-436';
    const config = parsePlatformConfig({ NODE_ENV: 'test', NOTIFICATIONS_PLATFORM_ORIGIN: s.deps.origin, NOTIFICATIONS_TELEGRAM_SECRET: credential });
    @Module({ controllers: [NotificationDispatchController], providers: [{ provide: Notifications, useValue: s.app }, { provide: PLATFORM_CONFIG, useValue: config }] })
    // oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete module class for the HTTP fixture.
    class DispatchTestModule {}
    const http = await NestFactory.create<NestFastifyApplication>(DispatchTestModule, new FastifyAdapter(), { logger: false });
    http.useGlobalFilters(new ProblemDetailsFilter());
    await http.init(); await http.getHttpAdapter().getInstance().ready();
    const payload = request(value, row.digest);
    try {
      const unauthorized = await http.inject({ method: 'POST', url: '/internal/notifications/dispatch/authorize', payload });
      expect(unauthorized.statusCode).toBe(401); expect(unauthorized.json<unknown>()).toEqual({ code: 'unauthorized' });
      const unknown = await http.inject({ method: 'POST', url: '/internal/notifications/dispatch/authorize', headers: { authorization: `Bearer ${credential}` }, payload: { ...payload, contractVersion: 'inside.notification-dispatch.v2' } });
      expect(unknown.statusCode).toBe(422); expect(unknown.json<unknown>()).toMatchObject({ ...payload, status: 'error', code: 'unsupported_contract' });
      const denied = await http.inject({ method: 'POST', url: '/internal/notifications/dispatch/authorize', headers: { authorization: `Bearer ${credential}` }, payload });
      expect(denied.statusCode).toBe(200); expect(denied.json<unknown>()).toMatchObject({ status: 'denied', reason: 'not_found' });
      const conflict = await http.inject({ method: 'POST', url: '/internal/notifications/dispatch/authorize', headers: { authorization: `Bearer ${credential}` }, payload: { ...payload, attemptRef: randomUUID() } });
      expect(conflict.statusCode).toBe(409); expect(conflict.headers['content-type']).toContain('application/json');
      expect(conflict.json<unknown>()).toMatchObject({ operationId: payload.operationId, status: 'error', code: 'operation_conflict' });
      expect(conflict.headers['cache-control']).toBe('private, no-store');
    } finally { await http.close(); }
  });
  test('SIGKILL after durable started cannot open another SMTP attempt after restart', async () => {
    const s = await scenario(); await s.publish(); const command = await s.admit();
    const child = fork(new URL('./fixtures/notification-email-crash.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { ...process.env, NOTIFICATION_CRASH_FIXTURE: JSON.stringify({ databaseUrl: database.url, actor: s.actor, now: s.deps.now().toISOString(), event: s.event, fact: s.fact }) },
    });
    try {
      const message: unknown = await once(child, 'message'); expect(message).toEqual(expect.arrayContaining(['started']));
      child.kill('SIGKILL'); await once(child, 'exit');
      let sends = 0;
      await dispatchEmail(s.deps, () => { sends += 1; return Promise.resolve({ state: 'sent' }); }, 'subscription');
      expect(sends).toBe(0);
      expect((await project(s.app, command.deliveryRef)).state).toBe('unknown');
      expect(await database.prisma.notificationEmailAttempt.count({ where: { deliveryId: command.deliveryRef } })).toBe(1);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  }, 15_000);
  test('audience checkpoint survives batches and excludes Accounts created after the occurrence', async () => {
    const s = await scenario('material');
    const existing = Array.from({ length: 31 }, () => randomUUID()).sort();
    await database.prisma.account.createMany({ data: existing.map(id => ({ id, logtoIssuer: 'https://identity.example.test', logtoSubject: id, createdAt: new Date('2026-09-08T11:00:00Z') })) });
    for (const actor of existing) await s.app.changePreferences(actor, { operationId: randomUUID(), expectedRevision: 0, email: true, telegram: false });
    const late = randomUUID();
    await database.prisma.account.create({ data: { id: late, logtoIssuer: 'https://identity.example.test', logtoSubject: late, createdAt: new Date('2026-09-08T12:01:00Z') } });
    await s.app.changePreferences(late, { operationId: randomUUID(), expectedRevision: 0, email: true, telegram: false });
    await s.publish();
    const restarted = { ...s.deps };
    for (let batch = 0; batch < 10; batch += 1) if (!(await expandAudience(restarted, 'materials', quarantined)).progressed) break;
    const audience = await database.prisma.notification.findMany({ where: { occurrenceRef: s.event.occurrenceRef }, select: { accountId: true } });
    expect(existing.every(id => audience.some(row => row.accountId === id))).toBe(true);
    expect(audience.some(row => row.accountId === late)).toBe(false);
    const total = audience.length;
    await s.app.acceptEvent(encodeNotification('materials', s.event)); await expandAudience(restarted, 'materials', quarantined);
    expect(await database.prisma.notification.count({ where: { occurrenceRef: s.event.occurrenceRef } })).toBe(total);
  });
  test('строка без настроенной доставки ждёт настройки, а не роняет разбор', async () => {
    const s = await scenario();
    const key = { scope_messageId: { scope: 'billing', messageId: s.event.messageId } };
    // Разбор берёт самую раннюю ожидающую строку дорожки, поэтому сценарий остаётся один на дорожке.
    await database.prisma.notificationInbox.deleteMany({ where: { lane: 'billing', completedAt: null } });
    s.advance(10_000);
    await s.app.acceptEvent(encodeNotification('billing', s.event));
    await database.prisma.notificationInbox.update({ where: key, data: { nextAttemptAt: s.deps.now() } });
    // Отсутствие адреса читателя — состояние настройки: раньше вместо него подставлялась пустая
    // строка, и разбор падал на `new URL('')`, унося весь worker.
    const expansion = await expandAudience({ ...s.deps, origin: undefined }, 'billing', quarantined);
    expect(expansion.observation).toMatchObject({ lane: 'billing', reason: 'delivery_not_configured' });
    const row = await database.prisma.notificationInbox.findUniqueOrThrow({ where: key });
    expect(row.completedAt).toBeNull();
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(s.deps.now().getTime());
    expect(await s.commands()).toHaveLength(0);
  });
  test('необрабатываемая строка получает повторные попытки, затем карантин, и разбор продолжается', async () => {
    const s = await scenario();
    const key = { scope_messageId: { scope: 'billing', messageId: s.event.messageId } };
    // Повод, который нельзя превратить в письмо: адрес читателя ведёт наружу Platform.
    s.source({ ...s.fact, readerPath: 'http://evil.example/path' });
    // Разбор берёт самую раннюю ожидающую строку дорожки, поэтому сценарий остаётся один на дорожке.
    await database.prisma.notificationInbox.deleteMany({ where: { lane: 'billing', completedAt: null } });
    s.advance(10_000);
    await s.app.acceptEvent(encodeNotification('billing', s.event));
    await database.prisma.notificationInbox.update({ where: key, data: { nextAttemptAt: s.deps.now() } });
    const quarantine: { lane: string; reason: string }[] = [];
    const record: QuarantineNotification = (lane, _bytes, reason) => { quarantine.push({ lane, reason }); return Promise.resolve(); };
    for (const attempt of [1, 2]) {
      const expansion = await expandAudience(s.deps, 'billing', record);
      expect(expansion.observation).toMatchObject({ lane: 'billing', reason: 'row_retry', attempts: attempt });
      expect(String(expansion.observation?.error)).toContain('notification_link_invalid');
      const pending = await database.prisma.notificationInbox.findUniqueOrThrow({ where: key });
      expect(pending.completedAt).toBeNull();
      expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(s.deps.now().getTime());
      s.advance(30_000);
    }
    expect(quarantine).toHaveLength(0);
    const final = await expandAudience(s.deps, 'billing', record);
    expect(final.observation).toMatchObject({ lane: 'billing', reason: 'row_quarantined', attempts: 3 });
    expect(quarantine).toEqual([{ lane: 'billing', reason: 'unprocessable_notification' }]);
    const done = await database.prisma.notificationInbox.findUniqueOrThrow({ where: key });
    expect(done.completedAt).not.toBeNull();
    // Разбор живёт дальше: следующая строка той же дорожки обрабатывается обычным путём.
    s.source(s.fact);
    const next = { ...s.event, messageId: randomUUID() };
    s.source({ ...s.fact, event: next });
    s.advance(10_000);
    await s.app.acceptEvent(encodeNotification('billing', next));
    await database.prisma.notificationInbox.update({ where: { scope_messageId: { scope: 'billing', messageId: next.messageId } }, data: { nextAttemptAt: s.deps.now() } });
    expect((await expandAudience(s.deps, 'billing', record)).progressed).toBe(true);
    const healthy = await database.prisma.notificationInbox.findUniqueOrThrow({ where: { scope_messageId: { scope: 'billing', messageId: next.messageId } } });
    expect(healthy.completedAt).not.toBeNull();
  });
  test('unavailable and invalid source facts never authorize an event, template links stay on Platform', async () => {
    const s = await scenario(); s.source({ status: 'unavailable' }); await s.publish(); expect(await s.commands()).toHaveLength(0);
    s.source({ ...s.fact, event: { ...s.event, occurrenceRef: randomUUID() } }); s.advance(30_000);
    await expandAudience(s.deps, 'billing', quarantined); expect(await s.commands()).toHaveLength(0);
    expect(() => renderNotification({ ...s.fact, readerPath: 'https://evil.example/path' }, standOrigin)).toThrow('notification_link_invalid');
  });
});
