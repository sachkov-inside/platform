import { z } from "zod";
import { idSchema, moneySchema, revisionSchema } from "./pricing.js";
import { renewalPriceSnapshot } from "./subscription-change.js";

/**
 * Служебные поводы подписки. Закрытый список принят в
 * [Notifications v1](../../../../../../docs/specifications/notifications-v1.md); Billing владеет
 * только фактом повода, а шаблон, канал и отправка принадлежат Notifications.
 */
export const noticeKinds = ["renewal_reminder", "payment_succeeded", "payment_failed",
  "renewal_cancelled", "access_expired", "refund_resolved"] as const;
export const noticeKindSchema = z.enum(noticeKinds);
export type NoticeKind = z.infer<typeof noticeKindSchema>;
export const noticeStateSchema = z.enum(["current", "superseded"]);

/** Страница кабинета, на которую ведёт служебное сообщение; origin принадлежит Notifications. */
export const BILLING_CABINET_PATH = "/account";
/** Напоминание о списании создаётся за три дня до даты списания. */
export const RENEWAL_REMINDER_LEAD_MS = 3 * 24 * 60 * 60 * 1_000;
/** Через сутки после самого события служебное сообщение перестаёт быть актуальным. */
export const NOTICE_LIFETIME_MS = 24 * 60 * 60 * 1_000;

/**
 * Выбор полей события своего источника. Полную неизменяемую форму провода проверяет AJV на
 * границе транспорта, поэтому момент здесь читается так же терпимо, как в принятом контракте.
 */
export const noticeEventSchema = z.strictObject({
  contractVersion: z.literal("inside.notification-event.v1"),
  messageId: idSchema, occurrenceRef: idSchema,
  sourceRef: z.string().min(1).max(128), sourceRevision: revisionSchema,
  occurredAt: z.iso.datetime({ offset: true }), notAfter: z.iso.datetime({ offset: true }),
  eventType: z.literal("billing.notice-ready"), accountRef: idSchema, kind: noticeKindSchema,
});
export type NoticeEvent = z.infer<typeof noticeEventSchema>;

/** Кабинетное представление повода: без текста сообщения, получателей и данных провайдера. */
export const noticeViewSchema = z.strictObject({
  noticeRef: idSchema, kind: noticeKindSchema, state: noticeStateSchema,
  occurredAt: z.iso.datetime(), amountKopecks: moneySchema.nullable(), dueAt: z.iso.datetime().nullable(),
});
export type NoticeView = z.infer<typeof noticeViewSchema>;

/** Что именно обещано получателю: название операции и, если они есть, сумма и дата. */
export interface NoticeConditions {
  readonly title: string;
  readonly amountKopecks?: number | undefined;
  readonly dueAt?: Date | undefined;
}
export interface NoticeOccurrence extends NoticeConditions {
  readonly kind: NoticeKind; readonly accountId: string; readonly sourceRef: string;
  readonly occurredAt: Date; readonly notAfter: Date;
  readonly subscriptionRef?: string | undefined; readonly attemptRef?: string | undefined;
}
/** Строка повода в условия: пустой столбец и отсутствие значения — одно и то же обещание. */
export function noticeConditions(row: { title: string; amountKopecks: bigint | null; dueAt: Date | null }): NoticeConditions {
  return { title: row.title, ...(row.amountKopecks === null ? {} : { amountKopecks: Number(row.amountKopecks) }),
    ...(row.dueAt === null ? {} : { dueAt: row.dueAt }) };
}
export function sameNoticeConditions(left: NoticeConditions, right: NoticeConditions): boolean {
  return left.title === right.title && left.amountKopecks === right.amountKopecks
    && left.dueAt?.getTime() === right.dueAt?.getTime();
}

/** Повод конкретной попытки: успех и отказ одной попытки — разные поводы одного платежа. */
export function attemptSourceRef(attemptRef: string): string {
  return `payment:${idSchema.parse(attemptRef)}`;
}
/** Один повод на предстоящий период: продление сдвигает период и создаёт следующий повод. */
export function renewalReminderSourceRef(subscriptionRef: string, periodIndex: number): string {
  return `subscription:${idSchema.parse(subscriptionRef)}:period:${revisionSchema.parse(periodIndex)}`;
}
export function subscriptionEndedSourceRef(subscriptionRef: string): string {
  return `subscription:${idSchema.parse(subscriptionRef)}:ended`;
}
export function renewalCancelledSourceRef(subscriptionRef: string, revision: number): string {
  return `subscription:${idSchema.parse(subscriptionRef)}:canceled:${revisionSchema.parse(revision)}`;
}

/** Событие описывает конкретную revision повода: повтор той же revision сохраняет messageId. */
export function noticeEvent(input: {
  readonly messageId: string; readonly occurrenceRef: string; readonly sourceRevision: number;
  readonly occurrence: NoticeOccurrence;
}): NoticeEvent {
  const { occurrence } = input;
  if (occurrence.occurredAt >= occurrence.notAfter) throw new Error("notice_window_invalid");
  return noticeEventSchema.parse({
    contractVersion: "inside.notification-event.v1", messageId: input.messageId,
    occurrenceRef: input.occurrenceRef, sourceRef: occurrence.sourceRef, sourceRevision: input.sourceRevision,
    occurredAt: occurrence.occurredAt.toISOString(), notAfter: occurrence.notAfter.toISOString(),
    eventType: "billing.notice-ready", accountRef: occurrence.accountId, kind: occurrence.kind,
  });
}

/** Повод самого события: срок жизни считается от того, когда оно произошло, а не когда замечено. */
export function lifecycleWindow(occurredAt: Date): { occurredAt: Date; notAfter: Date } {
  return { occurredAt, notAfter: new Date(occurredAt.getTime() + NOTICE_LIFETIME_MS) };
}

/** Предстоящее списание в доменных значениях: строка подписки остаётся у своего владельца. */
export interface RenewalReminderSubject {
  readonly subscriptionRef: string; readonly accountId: string;
  /** Расписание действует, и списать есть чем: без этого предстоящего списания нет. */
  readonly scheduled: boolean;
  readonly snapshot: unknown; readonly pendingChange: unknown;
  readonly paidUntil: Date; readonly nextPeriodIndex: number;
}

/**
 * Напоминание относится только к предстоящему списанию действующего расписания: отменённая
 * подписка, отозванная привязка и уже наступившая дата не дают повода. Дата, сумма и название
 * берутся из принятых условий следующего периода, а не из текущего каталога.
 */
export function planRenewalReminder(subject: RenewalReminderSubject, now: Date): NoticeOccurrence | undefined {
  if (!subject.scheduled) return undefined;
  if (subject.paidUntil <= now || subject.paidUntil.getTime() - now.getTime() > RENEWAL_REMINDER_LEAD_MS) return undefined;
  const snapshot = renewalPriceSnapshot(subject.snapshot, subject.pendingChange);
  return {
    kind: "renewal_reminder", accountId: subject.accountId,
    sourceRef: renewalReminderSourceRef(subject.subscriptionRef, subject.nextPeriodIndex),
    subscriptionRef: subject.subscriptionRef, title: snapshot.offer.name,
    amountKopecks: moneySchema.parse(snapshot.renewalPriceKopecks),
    occurredAt: now, notAfter: subject.paidUntil, dueAt: subject.paidUntil,
  };
}
