import { Prisma, type NotificationsPrisma } from '../../../infrastructure/prisma/index.js';
export async function lockNotification(transaction: NotificationsPrisma, key: string) {
  await transaction.$executeRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended(${`notifications:${key}`}, 0::bigint))`);
}
