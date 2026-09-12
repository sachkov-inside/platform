import { z } from 'zod';
import type { NotificationsPrismaClient } from '../../../infrastructure/prisma/index.js';
import { loggableFailure, type NotificationLane } from '../../../infrastructure/notification-transport/wire.js';
import type { QuarantineNotification } from '../ports/notification-sources.js';

/** Строка входящих в том виде, в каком решается её судьба: ключ выводится из неё, а не носится рядом. */
export type InboxRow = { readonly scope: string; readonly messageId: string; readonly payload: string };
export function inboxKey(row: InboxRow) { return { scope_messageId: { scope: row.scope, messageId: row.messageId } }; }
/** Что случилось при разборе: наблюдение уходит наружу, потому что модуль не пишет в журнал сам. */
export type SweepObservation = {
  readonly lane: NotificationLane | 'sweep';
  readonly messageId?: string;
  readonly reason: 'delivery_not_configured' | 'row_retry' | 'row_quarantined' | 'quarantine_unavailable'
    | 'lane_failed' | 'delivery_refresh_failed' | 'email_dispatch_failed';
  readonly attempts?: number;
  readonly error?: string;
  readonly quarantineError?: string;
};
/** Ошибка одной строки: она несёт строку, поэтому судьбу пишет вызывающий, а транзакция откатывается. */
export class UnprocessableRow extends Error {
  constructor(readonly row: InboxRow, readonly checkpoint: Record<string, unknown>, override readonly cause: unknown) {
    super('notification_row_unprocessable');
  }
}
export const ROW_RETRY_LIMIT = 3;
export const ROW_RETRY_DELAY_MS = 30_000;
const ROW_FAILURE_REASON = 'unprocessable_notification';
const attemptsSchema = z.object({ attempts: z.number().int().nonnegative().default(0) });
const checkpointSchema = z.record(z.string(), z.unknown());
/** Checkpoint строки как он есть: судьбе важно сохранить чужие поля, а не понимать их. */
export function asCheckpoint(value: unknown): Record<string, unknown> {
  const parsed = checkpointSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
/** Счётчик попыток живёт в checkpoint строки и переживает как отказ, так и частичный успех. */
export function rowAttempts(checkpoint: unknown): number {
  const parsed = attemptsSchema.safeParse(checkpoint);
  return parsed.success ? parsed.data.attempts : 0;
}
/**
 * Судьба строки, которую не удалось обработать: отложенная попытка со счётчиком, а после предела —
 * карантин с названной причиной и завершение. Вечного зависания с неподвижным сроком нет ни у одной
 * ветки: даже переполненный карантин отводит строку в сторону, иначе она возвращалась бы каждую
 * секунду и не давала дорожке дойти до отправки писем.
 */
export async function recordRowFailure(input: {
  prisma: NotificationsPrismaClient; now: () => Date; lane: NotificationLane;
  quarantine: QuarantineNotification; failure: UnprocessableRow;
}): Promise<SweepObservation> {
  const { prisma, now, lane, quarantine, failure } = input;
  const where = inboxKey(failure.row);
  // Счётчик не растёт за предел: после него он больше ничего не решает, а строка может ждать долго.
  const attempts = Math.min(rowAttempts(failure.checkpoint) + 1, ROW_RETRY_LIMIT);
  const checkpoint = { ...failure.checkpoint, attempts, reason: ROW_FAILURE_REASON };
  const observed = { lane, messageId: failure.row.messageId, attempts, error: loggableFailure(failure.cause) };
  const defer = async (reason: SweepObservation['reason']): Promise<SweepObservation> => {
    await prisma.notificationInbox.update({ where, data: { checkpoint, nextAttemptAt: new Date(now().getTime() + ROW_RETRY_DELAY_MS) } });
    return { ...observed, reason };
  };
  if (attempts < ROW_RETRY_LIMIT) return defer('row_retry');
  // Карантин пишется раньше завершения строки: отказ карантина иначе потерял бы сообщение совсем.
  try {
    await quarantine(lane, Buffer.from(failure.row.payload), ROW_FAILURE_REASON);
  } catch (error) {
    // Причина самой строки остаётся на месте: иначе оператор увидел бы только переполненный
    // карантин и не узнал бы, почему строка неисправна.
    return { ...(await defer('quarantine_unavailable')), quarantineError: loggableFailure(error) };
  }
  await prisma.notificationInbox.update({ where, data: { checkpoint, completedAt: now() } });
  return { ...observed, reason: 'row_quarantined' };
}
