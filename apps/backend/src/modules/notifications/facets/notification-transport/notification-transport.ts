import type { NotificationsPrismaClient } from '../../../../infrastructure/prisma/index.js';
import { assembleNotificationOutbox } from '../../../../infrastructure/notification-transport/outbox.js';
import type { NotificationEnvelope, NotificationLane } from '../../../../infrastructure/notification-transport/wire.js';
import { acceptTransportMessage, quarantineTransportMessage } from '../../features/accept-transport-message/accept-transport-message.js';

export function assembleNotificationTransport(prisma: NotificationsPrismaClient, quarantineCapacity: number) {
  return {
    outbox: assembleNotificationOutbox(prisma.notificationOutbox, ['telegramSubscription', 'telegramMaterial', 'emailSubscription', 'emailMaterial', 'emailResult']),
    accept: (envelope: NotificationEnvelope) => acceptTransportMessage(prisma, envelope),
    quarantine: (lane: NotificationLane, bytes: Buffer, reason: string) => quarantineTransportMessage(prisma, { lane, bytes, reason, capacity: quarantineCapacity, now: new Date() }),
    async observe() {
      const now = new Date();
      await prisma.notificationQuarantine.updateMany({ where: { payloadExpiresAt: { lte: now }, payload: { not: null } }, data: { payload: null } });
      return {
        pending: await prisma.notificationInbox.count({ where: { completedAt: null } }),
        oldest: (await prisma.notificationInbox.findFirst({ where: { completedAt: null }, orderBy: { receivedAt: 'asc' } }))?.receivedAt ?? null,
        quarantine: await prisma.notificationQuarantine.count({ where: { payload: { not: null } } }),
      };
    },
  };
}
export type NotificationTransport = ReturnType<typeof assembleNotificationTransport>;
