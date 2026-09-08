import type { BillingPrisma } from '../../../../infrastructure/prisma/index.js';
import { assembleNotificationOutbox, stageNotification } from '../../../../infrastructure/notification-transport/outbox.js';

// Call inside the source's fact transaction; no foreign transaction is exposed by a facet.
export function stageBillingNotification(transaction: BillingPrisma, event: unknown): Promise<void> {
  return stageNotification(transaction.billingNotificationOutbox, 'billing', event);
}
export function assembleBillingNotificationOutbox(prisma: BillingPrisma) {
  return assembleNotificationOutbox(prisma.billingNotificationOutbox, ['billing']);
}
