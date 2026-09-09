import { z } from 'zod';
import type { NotificationsPrismaClient, NotificationsPrisma } from '../../../../infrastructure/prisma/index.js';
import { lockNotification } from '../../infrastructure/locks.js';
import { fingerprint, type Channel } from '../../domain/notification-wire.js';
export const changePreferencesSchema = z.strictObject({
  operationId: z.uuid().transform(value => value.toLowerCase()), expectedRevision: z.number().int().nonnegative().max(2_147_483_646),
  email: z.boolean(), telegram: z.boolean(),
});
export const preferenceSchema = z.object({ revision: z.number().int().nonnegative(), email: z.boolean(), telegram: z.boolean() });
export type Preferences = z.infer<typeof preferenceSchema>;
export const preferenceResultSchema = z.union([z.object({ ok: z.literal(true), preferences: preferenceSchema }),
  z.object({ ok: z.literal(false), code: z.enum(['invalid_input', 'revision_conflict', 'operation_conflict']) })]);
export async function readPreferences(prisma: NotificationsPrisma, accountId: string): Promise<Preferences> {
  const row = await prisma.notificationPreference.findUnique({ where: { accountId } });
  return row ? { revision: row.revision, email: row.email, telegram: row.telegram } : { revision: 0, email: false, telegram: false };
}
export async function changePreferences(prisma: NotificationsPrismaClient, accountId: string, input: unknown, now: () => Date): Promise<z.infer<typeof preferenceResultSchema>> {
  const parsed = changePreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  const command = parsed.data;
  return prisma.$transaction(async transaction => {
    await lockNotification(transaction, `preferences:${accountId}`);
    const previous = await transaction.notificationPreferenceRevision.findUnique({ where: { accountId_operationId: { accountId, operationId: command.operationId } } });
    const digest = fingerprint(command);
    if (previous) return previous.fingerprint === digest ? { ok: true, preferences: { revision: previous.revision, email: previous.email, telegram: previous.telegram } } : { ok: false, code: 'operation_conflict' };
    const current = await readPreferences(transaction, accountId);
    if (current.revision !== command.expectedRevision) return { ok: false, code: 'revision_conflict' };
    const data = { accountId, revision: current.revision + 1, email: command.email, telegram: command.telegram, changedAt: now() };
    await transaction.notificationPreference.upsert({ where: { accountId }, create: data, update: data });
    await transaction.notificationPreferenceRevision.create({ data: { ...data, operationId: command.operationId, fingerprint: digest } });
    return { ok: true, preferences: { revision: data.revision, email: data.email, telegram: data.telegram } };
  });
}
export async function optedIn(prisma: NotificationsPrisma, accountId: string, channel: Channel, occurredAt: Date): Promise<boolean> {
  const historical = await prisma.notificationPreferenceRevision.findFirst({ where: { accountId, changedAt: { lt: occurredAt } }, orderBy: { revision: 'desc' } });
  return historical?.[channel] === true && (await readPreferences(prisma, accountId))[channel];
}
