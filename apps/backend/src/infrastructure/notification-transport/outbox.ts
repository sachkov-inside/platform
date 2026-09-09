import type { Prisma } from '../prisma/index.js';
import { encodeNotification, lanes, type NotificationEnvelope, type NotificationLane } from './wire.js';

// Three module-owned tables have the same transport columns; callers pass only their own delegate.
type OutboxRow = Prisma.NotificationOutboxGetPayload<Record<never, never>>;
type OutboxKey = { scope_messageId: { scope: string; messageId: string } };
export interface NotificationOutboxTable {
  upsert(args: { where: OutboxKey; create: { scope: string; messageId: string; lane: string; payload: string; digest: string }; update: Record<never, never> }): Promise<OutboxRow>;
  findFirst(args: { where: { lane: string; publishedAt: null; nextAttemptAt: { lte: Date } }; orderBy: ({ createdAt: 'asc' } | { messageId: 'asc' })[] }): Promise<OutboxRow | null>;
  update(args: { where: OutboxKey; data: { publishedAt?: Date; lastFailure: string | null; attempts?: { increment: number }; nextAttemptAt?: Date } }): Promise<OutboxRow>;
}
export interface NotificationOutbox {
  relay(lane: NotificationLane, publish: (envelope: NotificationEnvelope) => Promise<void>): Promise<boolean>;
}
export async function stageNotification(table: NotificationOutboxTable, lane: NotificationLane, input: unknown): Promise<void> {
  const envelope = encodeNotification(lane, input);
  const scope = lanes[lane].publisher;
  const row = await table.upsert({
    where: { scope_messageId: { scope, messageId: envelope.messageId } },
    create: { scope, messageId: envelope.messageId, lane, payload: envelope.payload, digest: envelope.digest },
    update: {},
  });
  if (row.digest !== envelope.digest || row.lane !== lane) throw new Error('notification_operation_conflict');
}
const RELAY_RETRY_INITIAL_MS = 1_000;
const RELAY_RETRY_MAX_MS = 60_000;
export function assembleNotificationOutbox(table: NotificationOutboxTable, allowed: readonly NotificationLane[], now: () => Date = () => new Date()): NotificationOutbox {
  return {
    async relay(lane, publish) {
      if (!allowed.includes(lane)) throw new Error('outbox_lane_forbidden');
      const row = await table.findFirst({ where: { lane, publishedAt: null, nextAttemptAt: { lte: now() } }, orderBy: [{ createdAt: 'asc' }, { messageId: 'asc' }] });
      if (!row) return false;
      const where = { scope_messageId: { scope: row.scope, messageId: row.messageId } };
      try {
        const envelope = encodeNotification(lane, JSON.parse(row.payload));
        if (envelope.digest !== row.digest || envelope.messageId !== row.messageId) throw new Error('outbox_integrity_failure');
        await publish(envelope);
        // A crash here deliberately republishes the same immutable ID after restart.
        await table.update({ where, data: { publishedAt: now(), lastFailure: null } });
      } catch (error) {
        await table.update({ where, data: {
          attempts: { increment: 1 }, lastFailure: 'publish_not_confirmed',
          nextAttemptAt: new Date(now().getTime() + Math.min(RELAY_RETRY_MAX_MS, RELAY_RETRY_INITIAL_MS * 2 ** Math.min(row.attempts, 6))),
        } });
        throw error;
      }
      return true;
    },
  };
}
