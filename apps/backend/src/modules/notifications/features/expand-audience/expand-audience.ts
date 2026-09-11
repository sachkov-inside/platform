import { stageDeliveryCommand } from '../../infrastructure/stage-delivery-command.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NotificationsPrismaClient } from '../../../../infrastructure/prisma/index.js';
import { MATERIAL_EVENT_LIFETIME_MS } from '../../../../infrastructure/notification-transport/wire.js';
import { eventSchema, deliverySchema, parseWire, commandWindow, fingerprint, type NotificationEvent, type Channel } from '../../domain/notification-wire.js';
import { renderNotification } from '../../domain/templates.js';
import type { NotificationRecipients, NotificationSources, NotificationSource } from '../../ports/notification-sources.js';
import { optedIn } from '../change-preferences/change-preferences.js';
import { lockNotification } from '../../infrastructure/locks.js';

export interface NotificationDependencies {
  prisma: NotificationsPrismaClient; sources: NotificationSources; recipients: NotificationRecipients;
  origin: string; now: () => Date;
}
export function validSource(event: NotificationEvent, source: NotificationSource): source is Extract<NotificationSource, { status: 'current' }> {
  if (source.status !== 'current') return false;
  const fact = source.event;
  return fingerprint(fact) === fingerprint(event) &&
    (event.eventType === 'material.published' ? source.content.category === 'material' && source.accountId === null :
      source.content.category === 'subscription' && source.content.kind === event.kind && source.accountId === event.accountRef);
}
const checkpointSchema = z.object({ after: z.uuid().nullable().default(null), recipients: z.number().int().nonnegative().default(0), reason: z.string().optional() });
// Capacity is bounded independently of audience membership; checkpoints use stable Account IDs.
const AUDIENCE_BATCH_SIZE = 25;
export async function expandAudience(deps: NotificationDependencies, lane: 'billing' | 'materials'): Promise<boolean> {
  const { prisma, now } = deps;
  return prisma.$transaction(async transaction => {
    await lockNotification(transaction, `audience:${lane}`);
    const row = await transaction.notificationInbox.findFirst({ where: { lane, completedAt: null, nextAttemptAt: { lte: now() } }, orderBy: [{ nextAttemptAt: 'asc' }, { receivedAt: 'asc' }, { messageId: 'asc' }] });
    if (!row) return false;
    const key = { scope_messageId: { scope: row.scope, messageId: row.messageId } };
    const { value: event } = parseWire(lane, JSON.parse(row.payload), eventSchema);
    const occurredAt = new Date(event.occurredAt);
    const deadline = new Date(event.notAfter);
    // One reading decides both that the event is still live and what window its commands get, so the
    // deadline cannot pass between the two and leave a command its own consumer refuses.
    const issuedAt = now();
    const invalid = occurredAt >= deadline || occurredAt > issuedAt || (lane === 'materials' && deadline.getTime() - occurredAt.getTime() !== MATERIAL_EVENT_LIFETIME_MS);
    const deliveryWindow = invalid ? null : commandWindow(issuedAt, deadline);
    if (!deliveryWindow) {
      await transaction.notificationInbox.update({ where: key, data: { completedAt: now(), checkpoint: { reason: invalid ? 'invalid_event_time' : 'expired' } } });
      return true;
    }
    const source = await deps.sources.resolve(event);
    if (source.status === 'unavailable') {
      await transaction.notificationInbox.update({ where: key, data: { nextAttemptAt: new Date(now().getTime() + 30_000) } });
      return false;
    }
    if (!validSource(event, source)) {
      await transaction.notificationInbox.update({ where: key, data: { completedAt: now(), checkpoint: { reason: 'source_conflict' } } });
      return true;
    }
    const checkpoint = checkpointSchema.parse(row.checkpoint);
    const accounts = source.accountId === null
      ? await deps.recipients.enumerate({ occurredAt, after: checkpoint.after, limit: AUDIENCE_BATCH_SIZE })
      : await deps.recipients.exists(source.accountId) ? [source.accountId] : [];
    let count = checkpoint.recipients;
    for (const accountId of accounts) {
      if (source.content.category === 'material') {
        const decision = await deps.sources.canRead(accountId, event.sourceRef);
        if (decision === 'unavailable') throw new Error('notification_access_unavailable');
        if (decision === 'denied') continue;
      }
      const channels: Channel[] = [];
      for (const channel of ['email', 'telegram'] as const) {
        if (source.content.category === 'subscription' || await optedIn(transaction, accountId, channel, occurredAt)) channels.push(channel);
      }
      if (channels.length === 0) continue;
      const notification = await transaction.notification.upsert({
        where: { kind_occurrenceRef_accountId: { kind: event.eventType, occurrenceRef: event.occurrenceRef, accountId } },
        create: { id: randomUUID(), kind: event.eventType, occurrenceRef: event.occurrenceRef, accountId, eventPayload: row.payload, sourceRevision: event.sourceRevision, createdAt: now() }, update: {},
      });
      await lockNotification(transaction, `notification:${notification.id}`);
      // A later source revision cannot replace a potentially started command. Keep its original correlation.
      if (notification.sourceRevision < event.sourceRevision) {
        await transaction.notification.update({ where: { id: notification.id }, data: { eventPayload: row.payload, sourceRevision: event.sourceRevision } });
        await transaction.notificationDelivery.updateMany({ where: { notificationId: notification.id, state: 'suppressed' }, data: { nextCommandAt: now() } });
      }
      for (const channel of channels) {
        const delivery = await transaction.notificationDelivery.upsert({ where: { notificationId_channel: { notificationId: notification.id, channel } },
          create: { id: randomUUID(), notificationId: notification.id, channel, updatedAt: now() }, update: {} });
        await lockNotification(transaction, `delivery:${delivery.id}`);
        // No new binding or source revision inherits a queued/started send.
        if (delivery.commandRevision > 0 || delivery.recoverySkipped) continue;
        const binding = await deps.recipients.binding(accountId, channel);
        if (!binding) continue;
        const template = renderNotification(source, deps.origin);
        const command = deliverySchema.parse({
          contractVersion: 'inside.notification-delivery.v1', operationId: randomUUID(), notificationRef: notification.id,
          deliveryRef: delivery.id, commandRevision: 1, sourceEventId: event.messageId, content: source.content,
          templateRef: template.templateRef, templateRevision: template.templateRevision, text: template.text,
          ...(channel === 'email' ? { subject: template.subject } : {}), binding, ...deliveryWindow,
        });
        await stageDeliveryCommand(transaction, command, now());
      }
      count += 1;
    }
    const done = source.accountId !== null || accounts.length < AUDIENCE_BATCH_SIZE;
    await transaction.notificationInbox.update({ where: key, data: { checkpoint: { after: accounts.at(-1) ?? checkpoint.after, recipients: count, ...(done && count === 0 ? { reason: 'no_eligible_recipient' } : {}) }, ...(done ? { completedAt: now() } : {}) } });
    return true;
  });
}
