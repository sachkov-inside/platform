import { randomUUID } from 'node:crypto';
import { stageNotification } from '../../../../infrastructure/notification-transport/outbox.js';
import { encodeNotification } from '../../../../infrastructure/notification-transport/wire.js';
import { deliverySchema, eventSchema, fingerprint, COMMAND_LIFETIME_MS, channelSchema } from '../../domain/notification-wire.js';
import { renderNotification } from '../../domain/templates.js';
import { lockNotification } from '../../infrastructure/locks.js';
import { optedIn } from '../change-preferences/change-preferences.js';
import { commandLane, validSource, type NotificationDependencies } from './expand-audience.js';

/** Replace only a command with a correlated not-started result, never merely an expired lease. */
export async function refreshDeliveries(deps: NotificationDependencies) {
  const candidates = await deps.prisma.notificationDelivery.findMany({ where: { state: 'suppressed', recoverySkipped: false, reason: { in: ['expired', 'superseded'] } }, orderBy: { updatedAt: 'asc' }, take: 25 });
  for (const candidate of candidates) await deps.prisma.$transaction(async transaction => {
    await lockNotification(transaction, `delivery:${candidate.id}`);
    const delivery = await transaction.notificationDelivery.findUniqueOrThrow({ where: { id: candidate.id }, include: { notification: true } });
    if (delivery.state !== 'suppressed' || delivery.recoverySkipped || delivery.commandRevision !== candidate.commandRevision) return;
    const stored = await transaction.notificationCommand.findUniqueOrThrow({ where: { deliveryId_revision: { deliveryId: delivery.id, revision: delivery.commandRevision } } });
    const old = deliverySchema.parse(JSON.parse(stored.payload));
    const event = eventSchema.parse(JSON.parse(delivery.notification.eventPayload));
    if (Date.parse(event.notAfter) <= deps.now().getTime()) return;
    const source = await deps.sources.resolve(event);
    if (!validSource(event, source)) return;
    const channel = channelSchema.parse(delivery.channel);
    if (source.content.category === 'material' && (!await optedIn(transaction, delivery.notification.accountId, channel, new Date(event.occurredAt)) || await deps.sources.canRead(delivery.notification.accountId, event.sourceRef) !== 'allowed')) return;
    const binding = await deps.recipients.binding(delivery.notification.accountId, channel);
    if (!binding || fingerprint(binding) !== fingerprint(old.binding)) return;
    const template = renderNotification(source, deps.origin);
    const command = { ...old, operationId: randomUUID(), commandRevision: old.commandRevision + 1, sourceEventId: event.messageId,
      content: source.content, templateRef: template.templateRef, templateRevision: template.templateRevision, text: template.text,
      ...(channel === 'email' ? { subject: template.subject } : {}), issuedAt: deps.now().toISOString(),
      notAfter: new Date(Math.min(Date.parse(event.notAfter), deps.now().getTime() + COMMAND_LIFETIME_MS)).toISOString() };
    const envelope = encodeNotification(commandLane(channel, source.content.category), command);
    await transaction.notificationCommand.create({ data: { operationId: command.operationId, deliveryId: delivery.id, revision: command.commandRevision, payload: envelope.payload, digest: envelope.digest.slice(7), createdAt: deps.now() } });
    await transaction.notificationDelivery.update({ where: { id: delivery.id }, data: { commandRevision: command.commandRevision, state: 'accepted', reason: null, attemptRef: null, updatedAt: deps.now() } });
    await stageNotification(transaction.notificationOutbox, envelope.lane, command);
  });
}
