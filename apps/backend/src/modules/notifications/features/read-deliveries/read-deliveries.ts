import { z } from 'zod';
import type { Accounts } from '../../../accounts/index.js';
import type { NotificationsPrismaClient } from '../../../../infrastructure/prisma/index.js';
import { lockNotification } from '../../infrastructure/locks.js';
import { fingerprint } from '../../domain/notification-wire.js';
export const recoverySchema = z.strictObject({ operationId: z.uuid(), deliveryRef: z.uuid(), action: z.literal('skip') });
export async function readDeliveries(prisma: NotificationsPrismaClient, accountId: string, after?: string) {
  return prisma.notificationDelivery.findMany({ where: { notification: { accountId }, ...(after ? { id: { gt: z.uuid().parse(after) } } : {}) }, orderBy: { id: 'asc' }, take: 50,
    select: { id: true, notificationId: true, channel: true, state: true, reason: true, commandRevision: true, resultRevision: true, recoverySkipped: true, updatedAt: true } });
}
export async function resolveUnknown(prisma: NotificationsPrismaClient, accounts: Accounts, actorId: string, input: unknown, now: () => Date) {
  const permission = await accounts.checkPermission({ accountId: actorId, permission: 'platform:admin' });
  if (!permission.ok || !permission.allowed) return { ok: false as const, code: 'forbidden' as const };
  const parsed = recoverySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: 'invalid_input' as const };
  const command = parsed.data;
  return prisma.$transaction(async transaction => {
    await lockNotification(transaction, `recovery:${command.operationId}`);
    await lockNotification(transaction, `delivery:${command.deliveryRef}`);
    const digest = fingerprint({ ...command, actorId });
    const old = await transaction.notificationRecoveryAudit.findUnique({ where: { operationId: command.operationId } });
    if (old) return old.fingerprint === digest ? { ok: true as const } : { ok: false as const, code: 'operation_conflict' as const };
    const delivery = await transaction.notificationDelivery.findUnique({ where: { id: command.deliveryRef } });
    if (!delivery || delivery.state !== 'unknown') return { ok: false as const, code: 'not_unknown' as const };
    await transaction.notificationRecoveryAudit.create({ data: { operationId: command.operationId, actorId, deliveryId: delivery.id, action: command.action, fingerprint: digest, createdAt: now() } });
    await transaction.notificationDelivery.update({ where: { id: delivery.id }, data: { recoverySkipped: true } });
    return { ok: true as const };
  });
}
