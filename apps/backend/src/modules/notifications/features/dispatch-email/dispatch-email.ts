import { randomUUID } from 'node:crypto';
import type { NotificationsPrisma, NotificationsPrismaClient } from '../../../../infrastructure/prisma/index.js';
import { stageNotification } from '../../../../infrastructure/notification-transport/outbox.js';
import { deliverySchema, resultSchema, parseWire, COMMAND_LIFETIME_MS, type DeliveryCommand, type DeliveryResult } from '../../domain/notification-wire.js';
import { lockNotification } from '../../infrastructure/locks.js';
import type { NotificationDependencies } from '../expand-audience/expand-audience.js';
import { authorizeDispatch } from '../authorize-dispatch/authorize-dispatch.js';
import type { SendNotificationEmail } from '../../ports/notification-sources.js';

const retryDelaysMs = [1_000, 5_000, 30_000] as const;
async function persistResult(transaction: NotificationsPrisma, command: DeliveryCommand, digest: string, now: Date,
  outcome: { state: DeliveryResult['state']; reason?: string; attemptRef?: string | null; receiptRef?: string; nextAttemptAt?: string }) {
  const effect = await transaction.notificationEmailEffect.findUniqueOrThrow({ where: { deliveryId: command.deliveryRef } });
  const result = resultSchema.parse({ contractVersion: 'inside.notification-result.v1', messageId: randomUUID(), operationId: command.operationId,
    deliveryRef: command.deliveryRef, commandRevision: command.commandRevision, payloadDigest: digest, resultRevision: effect.resultRevision + 1,
    channel: 'email', recordedAt: now.toISOString(), ...outcome });
  await stageNotification(transaction.notificationOutbox, 'emailResult', result);
  await transaction.notificationEmailEffect.update({ where: { deliveryId: command.deliveryRef }, data: { state: result.state,
    resultRevision: result.resultRevision, resultPayload: JSON.stringify(result), updatedAt: now,
    ...(result.nextAttemptAt ? { nextAttemptAt: new Date(result.nextAttemptAt) } : {}) } });
  return result;
}
async function replayResult(transaction: NotificationsPrisma, resultPayload: string) {
  const result = resultSchema.parse(JSON.parse(resultPayload));
  await stageNotification(transaction.notificationOutbox, 'emailResult', result);
  await transaction.notificationOutbox.update({ where: { scope_messageId: { scope: 'email', messageId: result.messageId } }, data: { publishedAt: null, nextAttemptAt: new Date() } });
}
export async function acceptEmailCommand(prisma: NotificationsPrismaClient, input: unknown, lane: 'emailMaterial' | 'emailSubscription', now: () => Date) {
  const { value: command, envelope } = parseWire(lane, input, deliverySchema);
  if (Date.parse(command.issuedAt) >= Date.parse(command.notAfter) || Date.parse(command.notAfter) - Date.parse(command.issuedAt) > COMMAND_LIFETIME_MS) return 'conflict' as const;
  return prisma.$transaction(async transaction => {
    await lockNotification(transaction, `email:${command.deliveryRef}`);
    const inserted = await transaction.notificationEmailInbox.createMany({ data: { operationId: command.operationId, deliveryId: command.deliveryRef,
      commandRevision: command.commandRevision, payload: envelope.payload, digest: envelope.digest, receivedAt: now() }, skipDuplicates: true });
    const old = await transaction.notificationEmailInbox.findUnique({ where: { operationId: command.operationId } });
    if (!old || old.digest !== envelope.digest || old.rejected) return 'conflict' as const;
    const effect = await transaction.notificationEmailEffect.findUnique({ where: { deliveryId: command.deliveryRef } });
    if (inserted.count === 0) {
      if (effect?.resultPayload && effect.operationId === command.operationId) await replayResult(transaction, effect.resultPayload);
      return 'duplicate' as const;
    }
    if (effect) {
      // Serialized with started. An incoming revision is never proof that the previous send did not start.
      if (effect.commandRevision >= command.commandRevision || !['suppressed', 'retrying'].includes(effect.state) || effect.state === 'retrying' && effect.attemptRef !== null) {
        await transaction.notificationEmailInbox.update({ where: { operationId: command.operationId }, data: { rejected: true } });
        return 'conflict' as const;
      }
      await transaction.notificationEmailEffect.update({ where: { deliveryId: command.deliveryRef }, data: { operationId: command.operationId, commandRevision: command.commandRevision,
        state: 'accepted', attemptRef: null, permitRef: null, retries: 0, nextAttemptAt: now(), updatedAt: now() } });
    } else {
      await transaction.notificationEmailEffect.create({ data: { deliveryId: command.deliveryRef, operationId: command.operationId, commandRevision: command.commandRevision,
        category: command.content.category, state: 'accepted', nextAttemptAt: now(), updatedAt: now() } });
    }
    await persistResult(transaction, command, envelope.digest.slice(7), now(), { state: 'accepted' });
    return 'accepted' as const;
  });
}
export async function dispatchEmail(deps: NotificationDependencies, send: SendNotificationEmail, category: 'material' | 'subscription'): Promise<boolean> {
  const rows = await deps.prisma.notificationEmailEffect.findMany({ where: { category, state: { in: ['accepted', 'retrying'] }, nextAttemptAt: { lte: deps.now() } }, orderBy: [{ nextAttemptAt: 'asc' }, { deliveryId: 'asc' }], take: 25 });
  for (const row of rows) {
    const inbox = await deps.prisma.notificationEmailInbox.findUniqueOrThrow({ where: { operationId: row.operationId } });
    const command = deliverySchema.parse(JSON.parse(inbox.payload));
    if (command.content.category !== category || command.binding.channel !== 'email') continue;
    const attemptRef = randomUUID();
    const request = { contractVersion: 'inside.notification-dispatch.v1', operationId: randomUUID(), deliveryOperationId: command.operationId,
      deliveryRef: command.deliveryRef, commandRevision: command.commandRevision, payloadDigest: inbox.digest.slice(7), attemptRef };
    const permit = await authorizeDispatch(deps, 'email', request);
    // Current verified contact is resolved through Accounts, never from the command or environment.
    const email = permit.status === 'allowed' ? await deps.recipients.email(command.binding) : null;
    const started = await deps.prisma.$transaction(async transaction => {
      await lockNotification(transaction, `email:${row.deliveryId}`);
      const current = await transaction.notificationEmailEffect.findUniqueOrThrow({ where: { deliveryId: row.deliveryId } });
      if (current.operationId !== row.operationId || !['accepted', 'retrying'].includes(current.state) || current.nextAttemptAt > deps.now()) return false;
      if (Date.parse(command.notAfter) <= deps.now().getTime() || permit.status === 'denied' || (permit.status === 'allowed' && (!email || Date.parse(permit.validUntil) <= deps.now().getTime()))) {
        await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'suppressed', reason: permit.status === 'denied' && !['not_found', 'payload_conflict'].includes(permit.reason) ? permit.reason : !email && permit.status === 'allowed' ? 'binding_conflict' : 'expired' });
        return false;
      }
      if (permit.status !== 'allowed') {
        const delay = retryDelaysMs[current.retries];
        if (delay === undefined) await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'failed', reason: 'retry_exhausted', attemptRef: current.attemptRef });
        else {
          await transaction.notificationEmailEffect.update({ where: { deliveryId: row.deliveryId }, data: { retries: { increment: 1 } } });
          await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'retrying', reason: 'source_unavailable', attemptRef: current.attemptRef, nextAttemptAt: new Date(deps.now().getTime() + delay).toISOString() });
        }
        return false;
      }
      await transaction.notificationEmailAttempt.create({ data: { id: attemptRef, deliveryId: row.deliveryId, operationId: command.operationId, permitRef: permit.permitRef, startedAt: deps.now(), state: 'unknown' } });
      await transaction.notificationEmailEffect.update({ where: { deliveryId: row.deliveryId }, data: { attemptRef, permitRef: permit.permitRef } });
      // Commit unknown and its result before I/O. Restart can publish evidence but can never retry this effect.
      await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'unknown', attemptRef, reason: 'interrupted_attempt' });
      return true;
    });
    if (!started || !email) return true;
    const outcome = await send({ email, subject: command.subject ?? '', text: command.text, operationId: command.operationId }).catch(() => ({ state: 'unknown' as const }));
    await deps.prisma.$transaction(async transaction => {
      await lockNotification(transaction, `email:${row.deliveryId}`);
      const effect = await transaction.notificationEmailEffect.findUniqueOrThrow({ where: { deliveryId: row.deliveryId } });
      if (effect.attemptRef !== attemptRef || effect.state !== 'unknown') throw new Error('email_attempt_conflict');
      const receiptRef = outcome.state === 'sent' ? randomUUID() : null;
      await transaction.notificationEmailAttempt.update({ where: { id: attemptRef }, data: { state: outcome.state, receiptRef, completedAt: deps.now() } });
      if (outcome.state === 'sent' && receiptRef) await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'sent', attemptRef, receiptRef });
      else if (outcome.state === 'failed') await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'failed', attemptRef, reason: outcome.reason });
      else if (outcome.state === 'unknown') await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'unknown', attemptRef, reason: 'lost_response' });
      else if (outcome.state === 'not_sent') {
        const delay = retryDelaysMs[effect.retries];
        const next = new Date(deps.now().getTime() + Math.max(delay ?? 0, outcome.retryAfterMs));
        if (delay === undefined || next.getTime() >= Date.parse(command.notAfter)) await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'failed', attemptRef, reason: 'retry_exhausted' });
        else {
          await transaction.notificationEmailEffect.update({ where: { deliveryId: row.deliveryId }, data: { retries: { increment: 1 } } });
          await persistResult(transaction, command, inbox.digest.slice(7), deps.now(), { state: 'retrying', attemptRef, reason: 'rate_limited', nextAttemptAt: next.toISOString() });
        }
      }
      await transaction.notificationEmailInbox.update({ where: { operationId: command.operationId }, data: { completedAt: deps.now() } });
    });
    return true;
  }
  return false;
}
