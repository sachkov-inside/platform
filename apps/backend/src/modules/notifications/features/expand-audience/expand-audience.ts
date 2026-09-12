import { stageDeliveryCommand } from '../../infrastructure/stage-delivery-command.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NotificationsPrisma, NotificationsPrismaClient } from '../../../../infrastructure/prisma/index.js';
import { MATERIAL_EVENT_LIFETIME_MS } from '../../../../infrastructure/notification-transport/wire.js';
import { eventSchema, deliverySchema, parseWire, commandWindow, fingerprint, type NotificationEvent, type Channel } from '../../domain/notification-wire.js';
import { renderNotification } from '../../domain/templates.js';
import type { NotificationRecipients, NotificationSources, NotificationSource, QuarantineNotification } from '../../ports/notification-sources.js';
import { optedIn } from '../change-preferences/change-preferences.js';
import { lockNotification } from '../../infrastructure/locks.js';
import { inboxKey, recordRowFailure, UnprocessableRow, type InboxRow, type SweepObservation } from '../../infrastructure/row-fate.js';

export interface NotificationDependencies {
  prisma: NotificationsPrismaClient; sources: NotificationSources; recipients: NotificationRecipients;
  /** Адрес читателя. Его может не быть: доставка настраивается отдельно от приёма событий. */
  origin: string | undefined; now: () => Date;
}
const DELIVERY_WAIT_MS = 30_000;
/** Недоступный источник или решение о доступе — состояние зависимости: строка ждёт столько же. */
const SOURCE_WAIT_MS = 30_000;
export function validSource(event: NotificationEvent, source: NotificationSource): source is Extract<NotificationSource, { status: 'current' }> {
  if (source.status !== 'current') return false;
  const fact = source.event;
  return fingerprint(fact) === fingerprint(event) &&
    (event.eventType === 'material.published' ? source.content.category === 'material' && source.accountId === null :
      source.content.category === 'subscription' && source.content.kind === event.kind && source.accountId === event.accountRef);
}
const checkpointSchema = z.object({ after: z.uuid().nullable().default(null), recipients: z.number().int().nonnegative().default(0),
  attempts: z.number().int().nonnegative().default(0), reason: z.string().optional() });
// Capacity is bounded independently of audience membership; checkpoints use stable Account IDs.
const AUDIENCE_BATCH_SIZE = 25;
/**
 * Одна строка входящих не может остановить остальные: её отказ становится отложенной попыткой, а
 * затем карантином с названной причиной. Раньше исключение уходило из задачи и гасило весь worker.
 */
export async function expandAudience(
  deps: NotificationDependencies, lane: 'billing' | 'materials', quarantine: QuarantineNotification,
): Promise<AudienceExpansion> {
  try {
    return await expandAudienceOnce(deps, lane);
  } catch (error) {
    if (!(error instanceof UnprocessableRow)) throw error;
    const { prisma, now } = deps;
    return { progressed: true, observation: await recordRowFailure({ prisma, now, lane, quarantine, failure: error }) };
  }
}
export interface AudienceExpansion { readonly progressed: boolean; readonly observation?: SweepObservation }
async function expandAudienceOnce(deps: NotificationDependencies, lane: 'billing' | 'materials'): Promise<AudienceExpansion> {
  const { prisma, now } = deps;
  return prisma.$transaction(async transaction => {
    await lockNotification(transaction, `audience:${lane}`);
    const row = await transaction.notificationInbox.findFirst({ where: { lane, completedAt: null, nextAttemptAt: { lte: now() } }, orderBy: [{ nextAttemptAt: 'asc' }, { receivedAt: 'asc' }, { messageId: 'asc' }] });
    if (!row) return { progressed: false };
    const checkpoint = parseCheckpoint(row.checkpoint);
    try {
      return await expandRow(transaction, deps, lane, row, checkpoint);
    } catch (error) {
      // Транзакция откатывается, поэтому судьбу строки записывает вызывающий отдельной записью.
      throw new UnprocessableRow(row, checkpoint, error);
    }
  });
}
function parseCheckpoint(value: unknown): z.infer<typeof checkpointSchema> {
  const parsed = checkpointSchema.safeParse(value);
  return parsed.success ? parsed.data : { after: null, recipients: 0, attempts: 0 };
}
async function expandRow(
  transaction: NotificationsPrisma, deps: NotificationDependencies, lane: 'billing' | 'materials',
  row: InboxRow, checkpoint: z.infer<typeof checkpointSchema>,
): Promise<AudienceExpansion> {
  const { now } = deps;
  const key = inboxKey(row);
  const { value: event } = parseWire(lane, JSON.parse(row.payload), eventSchema);
  const occurredAt = new Date(event.occurredAt);
  const deadline = new Date(event.notAfter);
  // One reading decides both that the event is still live and what window its commands get, so the
  // deadline cannot pass between the two and leave a command its own consumer refuses.
  const issuedAt = now();
  const invalid = occurredAt >= deadline || occurredAt > issuedAt || (lane === 'materials' && deadline.getTime() - occurredAt.getTime() !== MATERIAL_EVENT_LIFETIME_MS);
  const deliveryWindow = invalid ? null : commandWindow(issuedAt, deadline);
  if (!deliveryWindow) {
    await transaction.notificationInbox.update({ where: key, data: { completedAt: now(), checkpoint: { ...checkpoint, reason: invalid ? 'invalid_event_time' : 'expired' } } });
    return { progressed: true };
  }
  // Адрес читателя — часть настройки доставки, а не свойство события: пока его нет, повод ждёт.
  // Пустая строка вместо адреса раньше доходила до шаблона и роняла разбор целиком.
  const origin = deps.origin;
  if (origin === undefined) {
    await transaction.notificationInbox.update({ where: key, data: { nextAttemptAt: new Date(now().getTime() + DELIVERY_WAIT_MS) } });
    return { progressed: false, observation: { lane, messageId: row.messageId, reason: 'delivery_not_configured' } };
  }
  const source = await deps.sources.resolve(event);
  if (source.status === 'unavailable') {
    await transaction.notificationInbox.update({ where: key, data: { nextAttemptAt: new Date(now().getTime() + SOURCE_WAIT_MS) } });
    return { progressed: false };
  }
  if (!validSource(event, source)) {
    await transaction.notificationInbox.update({ where: key, data: { completedAt: now(), checkpoint: { ...checkpoint, reason: 'source_conflict' } } });
    return { progressed: true };
  }
  const accounts = source.accountId === null
    ? await deps.recipients.enumerate({ occurredAt, after: checkpoint.after, limit: AUDIENCE_BATCH_SIZE })
    : await deps.recipients.exists(source.accountId) ? [source.accountId] : [];
  let count = checkpoint.recipients;
  for (const accountId of accounts) {
    if (source.content.category === 'material') {
      const decision = await deps.sources.canRead(accountId, event.sourceRef);
      // Недоступное решение о доступе — состояние зависимости, а не порча сообщения: строка ждёт
      // так же, как при недоступном источнике, и попытка ей не засчитывается.
      if (decision === 'unavailable') {
        await transaction.notificationInbox.update({ where: key, data: { nextAttemptAt: new Date(now().getTime() + SOURCE_WAIT_MS) } });
        return { progressed: false };
      }
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
      const template = renderNotification(source, origin);
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
  await transaction.notificationInbox.update({ where: key, data: { checkpoint: { after: accounts.at(-1) ?? checkpoint.after, recipients: count, attempts: checkpoint.attempts, ...(done && count === 0 ? { reason: 'no_eligible_recipient' } : {}) }, ...(done ? { completedAt: now() } : {}) } });
  return { progressed: true };
}
