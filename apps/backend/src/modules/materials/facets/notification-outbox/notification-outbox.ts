import type { MaterialsPrisma } from '../../../../infrastructure/prisma/index.js';
import { assembleNotificationOutbox, stageNotification } from '../../../../infrastructure/notification-transport/outbox.js';

// Call inside the source's fact transaction; no foreign transaction is exposed by a facet.
export function stageMaterialsNotification(transaction: MaterialsPrisma, event: unknown): Promise<void> {
  return stageNotification(transaction.materialNotificationOutbox, 'materials', event);
}
export function assembleMaterialsNotificationOutbox(prisma: MaterialsPrisma) {
  return assembleNotificationOutbox(prisma.materialNotificationOutbox, ['materials']);
}
