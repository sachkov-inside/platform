import type { NotificationsPrisma } from '../../../infrastructure/prisma/index.js';
import { stageNotification } from '../../../infrastructure/notification-transport/outbox.js';
import { encodeNotification, type NotificationLane } from '../../../infrastructure/notification-transport/wire.js';
import type { Channel, DeliveryCommand } from '../domain/notification-wire.js';
export function commandLane(channel: Channel, category: 'material' | 'subscription'): NotificationLane {
  return channel === 'email' ? category === 'material' ? 'emailMaterial' : 'emailSubscription' : category === 'material' ? 'telegramMaterial' : 'telegramSubscription';
}
/** Called within the Delivery lock: immutable command, current revision and outbox commit together. */
export async function stageDeliveryCommand(transaction: NotificationsPrisma, command: DeliveryCommand, now: Date) {
  const envelope = encodeNotification(commandLane(command.binding.channel, command.content.category), command);
  await transaction.notificationCommand.create({ data: { operationId: command.operationId, deliveryId: command.deliveryRef, revision: command.commandRevision,
    payload: envelope.payload, digest: envelope.digest.slice('sha256:'.length), createdAt: now } });
  await transaction.notificationDelivery.update({ where: { id: command.deliveryRef }, data: { commandRevision: command.commandRevision, state: 'accepted', reason: null, attemptRef: null, updatedAt: now } });
  await stageNotification(transaction.notificationOutbox, envelope.lane, command);
}
