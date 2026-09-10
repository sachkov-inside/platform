import { randomUUID } from "node:crypto";
import type { BillingPrisma } from "../../../infrastructure/prisma/index.js";
import { noticeConditions, noticeEvent, sameNoticeConditions, type NoticeOccurrence } from "../domain/notice.js";
import { stageBillingNotification } from "../facets/notification-outbox/notification-outbox.js";

export type NoticeOutcome = "created" | "refreshed" | "unchanged";

function unchanged(row: {
  title: string; amountKopecks: bigint | null; dueAt: Date | null; notAfter: Date; state: string;
}, occurrence: NoticeOccurrence): boolean {
  return row.state === "current" && sameNoticeConditions(noticeConditions(row), occurrence)
    && row.notAfter.getTime() === occurrence.notAfter.getTime();
}

/**
 * Вызывается внутри транзакции, которая сохраняет сам факт источника: повод, его неизменяемая
 * revision и строка outbox фиксируются вместе, поэтому обещание уведомления не может пережить
 * откат платежа, а сбой канала не может отменить платёж.
 *
 * Один повод существует один раз на (kind, sourceRef). Изменение условий выпускает следующую
 * revision с новым messageId: прежняя перестаёт быть актуальной, но повод остаётся тем же, и
 * Notifications не создаёт вторую Notification.
 */
export async function recordBillingNotice(tx: BillingPrisma, occurrence: NoticeOccurrence, now: Date): Promise<NoticeOutcome> {
  const existing = await tx.billingNotice.findUnique({ where: { kind_sourceRef: { kind: occurrence.kind, sourceRef: occurrence.sourceRef } } });
  if (existing && unchanged(existing, occurrence)) return "unchanged";
  const noticeRef = existing?.id ?? randomUUID();
  const revision = (existing?.revision ?? 0) + 1;
  const event = noticeEvent({ messageId: randomUUID(), occurrenceRef: noticeRef, sourceRevision: revision,
    // Повторная запись сохраняет исходный момент повода: меняются только его условия.
    occurrence: existing ? { ...occurrence, occurredAt: existing.occurredAt } : occurrence });
  const conditions = { revision, state: "current", notAfter: occurrence.notAfter, title: occurrence.title,
    amountKopecks: occurrence.amountKopecks === undefined ? null : BigInt(occurrence.amountKopecks),
    dueAt: occurrence.dueAt ?? null, updatedAt: now };
  if (existing) await tx.billingNotice.update({ where: { id: noticeRef }, data: conditions });
  else await tx.billingNotice.create({ data: {
    id: noticeRef, accountId: occurrence.accountId, kind: occurrence.kind, sourceRef: occurrence.sourceRef,
    subscriptionRef: occurrence.subscriptionRef ?? null, attemptRef: occurrence.attemptRef ?? null,
    occurredAt: occurrence.occurredAt, createdAt: now, ...conditions } });
  await tx.billingNoticeRevision.create({ data: { noticeRef, revision, messageId: event.messageId, payload: event, createdAt: now } });
  await stageBillingNotification(tx, event);
  return existing ? "refreshed" : "created";
}

/**
 * Условия следующего списания изменились: прежнее напоминание больше не актуально. Уже начатую
 * доставку это не отменяет — оно перестаёт быть основанием для новой отправки, а расписание
 * выпускает следующую revision, когда списание снова предстоит.
 */
export async function supersedeRenewalReminders(tx: BillingPrisma, subscriptionRef: string, now: Date): Promise<number> {
  const { count } = await tx.billingNotice.updateMany({
    where: { subscriptionRef, kind: "renewal_reminder", state: "current" }, data: { state: "superseded", updatedAt: now } });
  return count;
}
