import { Prisma, type NotificationsPrismaClient } from '../../../../infrastructure/prisma/index.js';
import { lanes, type NotificationEnvelope, type NotificationLane, digestNotificationPayload, NOTIFICATION_MESSAGE_MAX_BYTES } from '../../../../infrastructure/notification-transport/wire.js';

const QUARANTINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export async function acceptTransportMessage(prisma: NotificationsPrismaClient, envelope: NotificationEnvelope): Promise<'accepted' | 'duplicate' | 'conflict'> {
  return prisma.$transaction(async transaction => {
    const scope = lanes[envelope.lane].publisher;
    // The inbox row IS the recoverable job: a pending row and its checkpoint commit together.
    const inserted = await transaction.notificationInbox.createMany({ data: {
      scope, messageId: envelope.messageId, lane: envelope.lane, payload: envelope.payload, digest: envelope.digest,
    }, skipDuplicates: true });
    const row = await transaction.notificationInbox.findUniqueOrThrow({ where: { scope_messageId: { scope, messageId: envelope.messageId } } });
    if (row.digest !== envelope.digest || row.lane !== envelope.lane) return 'conflict';
    return inserted.count === 1 ? 'accepted' : 'duplicate';
  });
}
export async function quarantineTransportMessage(prisma: NotificationsPrismaClient, input: {
  lane: NotificationLane; bytes: Buffer; reason: string; capacity: number; now: Date;
}): Promise<void> {
  const digest = digestNotificationPayload(input.bytes);
  const key = `${input.lane}:${input.reason}:${digest}`;
  await prisma.$transaction(async transaction => {
    // Serialize admission and expiry so concurrent poison messages cannot overrun the bound.
    await transaction.$executeRaw(Prisma.sql`select pg_advisory_xact_lock(hashtextextended('notifications:quarantine', 0::bigint))`);
    await transaction.notificationQuarantine.updateMany({ where: { payloadExpiresAt: { lte: input.now }, payload: { not: null } }, data: { payload: null } });
    if (await transaction.notificationQuarantine.findUnique({ where: { key } })) return;
    const retained = await transaction.notificationQuarantine.count({ where: { payload: { not: null } } });
    if (retained >= input.capacity) throw new Error('notification_quarantine_full');
    await transaction.notificationQuarantine.create({ data: {
      key, lane: input.lane, reason: input.reason, digest,
      payload: input.bytes.subarray(0, NOTIFICATION_MESSAGE_MAX_BYTES).toString('base64'),
      receivedAt: input.now, payloadExpiresAt: new Date(input.now.getTime() + QUARANTINE_RETENTION_MS),
    } });
  });
}
