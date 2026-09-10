import { stageDeliveryCommand } from '../../infrastructure/stage-delivery-command.js';
import { randomUUID } from 'node:crypto';
import { deliverySchema, eventSchema, fingerprint, commandWindow, channelSchema } from '../../domain/notification-wire.js';
import { renderNotification } from '../../domain/templates.js';
import { lockNotification } from '../../infrastructure/locks.js';
import { optedIn } from '../change-preferences/change-preferences.js';
import { validSource, type NotificationDependencies } from './expand-audience.js';

/** Replace only a command with a correlated not-started result, never merely an expired lease. */
export async function refreshDeliveries(deps: NotificationDependencies) {
  const candidates = await deps.prisma.notificationDelivery.findMany({ where: { state: 'suppressed', recoverySkipped: false, nextCommandAt: { lte: deps.now() }, reason: { in: ['expired', 'superseded'] } }, orderBy: [{ nextCommandAt: 'asc' }, { id: 'asc' }], take: 25 });
  for (const candidate of candidates) await deps.prisma.$transaction(async transaction => {
    await lockNotification(transaction, `delivery:${candidate.id}`);
    const delivery = await transaction.notificationDelivery.findUniqueOrThrow({ where: { id: candidate.id }, include: { notification: true } });
    if (delivery.state !== 'suppressed' || delivery.recoverySkipped || delivery.commandRevision !== candidate.commandRevision) return;
    await transaction.notificationDelivery.update({ where: { id: delivery.id }, data: { nextCommandAt: new Date(deps.now().getTime() + 30_000) } });
    const stored = await transaction.notificationCommand.findUniqueOrThrow({ where: { deliveryId_revision: { deliveryId: delivery.id, revision: delivery.commandRevision } } });
    const old = deliverySchema.parse(JSON.parse(stored.payload));
    const event = eventSchema.parse(JSON.parse(delivery.notification.eventPayload));
    if (Date.parse(event.notAfter) <= deps.now().getTime()) {
      await transaction.notificationDelivery.update({ where: { id: delivery.id }, data: { nextCommandAt: null } });
      return;
    }
    const source = await deps.sources.resolve(event);
    if (!validSource(event, source)) return;
    const channel = channelSchema.parse(delivery.channel);
    if (source.content.category === 'material' && (!await optedIn(transaction, delivery.notification.accountId, channel, new Date(event.occurredAt)) || await deps.sources.canRead(delivery.notification.accountId, event.sourceRef) !== 'allowed')) return;
    const binding = await deps.recipients.binding(delivery.notification.accountId, channel);
    if (!binding || fingerprint(binding) !== fingerprint(old.binding)) return;
    const deliveryWindow = commandWindow(deps.now(), new Date(event.notAfter));
    if (!deliveryWindow) return;
    const template = renderNotification(source, deps.origin);
    const command = { ...old, operationId: randomUUID(), commandRevision: old.commandRevision + 1, sourceEventId: event.messageId,
      content: source.content, templateRef: template.templateRef, templateRevision: template.templateRevision, text: template.text,
      ...(channel === 'email' ? { subject: template.subject } : {}), ...deliveryWindow };
    await stageDeliveryCommand(transaction, command, deps.now());
  });
}
