import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from './setup/test-database.js';
import { Notifications, type NotificationDependencies, type NotificationSource } from '../../src/modules/notifications/index.js';
import { NotificationAccounts, assembleAccounts } from '../../src/modules/accounts/index.js';
import { BillingContact } from '../../src/modules/accounts/facets/billing-contact/billing-contact.js';
import { billingContactProtection } from '../../src/modules/accounts/infrastructure/billing-contact-protection.js';
import { encodeNotification } from '../../src/infrastructure/notification-transport/wire.js';
import { expandAudience } from '../../src/modules/notifications/features/expand-audience/expand-audience.js';
import { dispatchEmail, acceptEmailCommand } from '../../src/modules/notifications/features/dispatch-email/dispatch-email.js';
import { refreshDeliveries } from '../../src/modules/notifications/features/expand-audience/refresh-deliveries.js';
import { deliverySchema, resultSchema, type NotificationEvent, type DeliveryCommand, type AuthorizeRequest } from '../../src/modules/notifications/domain/notification-wire.js';
import { renderNotification } from '../../src/modules/notifications/domain/templates.js';
const protection = billingContactProtection(Buffer.alloc(32, 43).toString('base64'));

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
    const deps: NotificationDependencies = { prisma: database.prisma, origin: 'https://inside.example.test', now,
      sources: { resolve: candidate => Promise.resolve(candidate.occurrenceRef === event.occurrenceRef ? source : { status: 'unavailable' }), canRead: () => Promise.resolve(access) },
      recipients: { exists: id => contacts.exists(id), enumerate: query => contacts.enumerate(query), binding: (id, channel) => channel === 'email' ? contacts.binding(id) : Promise.resolve(null), email: binding => contacts.email(binding) } };
    const accounts = assembleAccounts({ prisma: database.prisma, emailFingerprintKey: 'notification-test-key-long-enough' });
    const app = new Notifications(deps, accounts);
    const advance = (ms: number) => { instant = new Date(instant.getTime() + ms); };
    const publish = async () => { advance(10_000); await app.acceptEvent(encodeNotification(category === 'material' ? 'materials' : 'billing', event)); await expandAudience(deps, category === 'material' ? 'materials' : 'billing'); };
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
    await expandAudience(s.deps, 'billing');
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
    await expandAudience(late.deps, 'materials');
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
    await refreshDeliveries(s.deps); expect(await s.commands()).toHaveLength(2);
    const next = await s.admit(); expect(next.commandRevision).toBe(2); expect(next.deliveryRef).toBe(c.deliveryRef);
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
  test('SIGKILL after durable started cannot open another SMTP attempt after restart', async () => {
    const s = await scenario(); await s.publish(); const command = await s.admit();
    const child = fork(new URL('./fixtures/notification-email-crash.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { ...process.env, NOTIFICATION_CRASH_FIXTURE: JSON.stringify({ databaseUrl: database.url, actor: s.actor, now: s.deps.now().toISOString(), event: s.event, fact: s.fact }) },
    });
    try {
      const [message] = await once(child, 'message'); expect(message).toBe('started');
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
    for (let batch = 0; batch < 10; batch += 1) if (!await expandAudience(restarted, 'materials')) break;
    const audience = await database.prisma.notification.findMany({ where: { occurrenceRef: s.event.occurrenceRef }, select: { accountId: true } });
    expect(existing.every(id => audience.some(row => row.accountId === id))).toBe(true);
    expect(audience.some(row => row.accountId === late)).toBe(false);
    const total = audience.length;
    await s.app.acceptEvent(encodeNotification('materials', s.event)); await expandAudience(restarted, 'materials');
    expect(await database.prisma.notification.count({ where: { occurrenceRef: s.event.occurrenceRef } })).toBe(total);
  });
  test('unavailable and invalid source facts never authorize an event, template links stay on Platform', async () => {
    const s = await scenario(); s.source({ status: 'unavailable' }); await s.publish(); expect(await s.commands()).toHaveLength(0);
    s.source({ ...s.fact, event: { ...s.event, occurrenceRef: randomUUID() } });
    await expandAudience(s.deps, 'billing'); expect(await s.commands()).toHaveLength(0);
    expect(() => renderNotification({ ...s.fact, readerPath: 'https://evil.example/path' }, s.deps.origin)).toThrow('notification_link_invalid');
  });
});
