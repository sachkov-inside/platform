import type { NotificationsPrismaClient } from '../../../../infrastructure/prisma/index.js';
import { parseWire, resultSchema, dispatchResponseSchema, type Channel } from '../../domain/notification-wire.js';
import { lockNotification } from '../../infrastructure/locks.js';

export async function acceptDeliveryResult(prisma: NotificationsPrismaClient, channel: Channel, input: unknown) {
  const { value: result, envelope } = parseWire(channel === 'email' ? 'emailResult' : 'telegramResult', input, resultSchema);
  return prisma.$transaction(async transaction => {
    await lockNotification(transaction, `delivery:${result.deliveryRef}`);
    const command = await transaction.notificationCommand.findUnique({ where: { operationId: result.operationId }, include: { delivery: true } });
    if (!command || command.deliveryId !== result.deliveryRef || command.revision !== result.commandRevision || command.digest !== result.payloadDigest || command.delivery.channel !== channel) return 'correlation_conflict' as const;
    const current = command.delivery;
    if (result.attemptRef) {
      const permits = await transaction.notificationAuthorization.findMany({ where: { channel, deliveryId: result.deliveryRef, attemptRef: result.attemptRef } });
      if (!permits.some(row => {
        const response = dispatchResponseSchema.parse(JSON.parse(row.response));
        return response.status === 'allowed' && response.deliveryOperationId === result.operationId && response.payloadDigest === result.payloadDigest;
      })) return 'attempt_conflict' as const;
    } else if (['sent', 'unknown'].includes(result.state) || (current.state === 'unknown' && ['failed', 'retrying'].includes(result.state))) return 'attempt_conflict' as const;
    const byMessage = await transaction.notificationResult.findUnique({ where: { channel_messageId: { channel, messageId: result.messageId } } });
    const byRevision = await transaction.notificationResult.findUnique({ where: { deliveryId_revision: { deliveryId: result.deliveryRef, revision: result.resultRevision } } });
    if (byMessage || byRevision) return (byMessage ?? byRevision)?.digest === envelope.digest ? 'duplicate' as const : 'operation_conflict' as const;
    // Validate even old results before storing them. Retain late evidence for operator inspection.
    await transaction.notificationResult.create({ data: { channel, messageId: result.messageId, deliveryId: result.deliveryRef, revision: result.resultRevision, digest: envelope.digest, payload: envelope.payload, recordedAt: new Date(result.recordedAt) } });
    if (result.resultRevision < current.resultRevision || command.revision < current.commandRevision) return 'stale' as const;
    if (current.state === 'sent' && result.state !== 'sent') return 'transition_conflict' as const;
    if (current.state === 'unknown' && (result.attemptRef !== current.attemptRef || !['sent', 'failed', 'retrying', 'unknown'].includes(result.state))) return 'attempt_conflict' as const;
    if (current.state === 'unknown' && result.state === 'retrying' && !['rate_limited', 'provider_unavailable'].includes(result.reason ?? '')) return 'transition_conflict' as const;
    if (current.state === 'retrying' && result.state === 'accepted') return 'transition_conflict' as const;
    await transaction.notificationDelivery.update({ where: { id: result.deliveryRef }, data: {
      state: result.state, reason: result.reason ?? null, resultRevision: result.resultRevision, resultDigest: envelope.digest,
      attemptRef: result.attemptRef ?? null, updatedAt: new Date(result.recordedAt),
    } });
    return 'accepted' as const;
  });
}
