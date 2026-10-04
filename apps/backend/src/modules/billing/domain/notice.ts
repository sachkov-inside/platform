import { z } from "zod";
import { idSchema, moneySchema, revisionSchema } from "./pricing.js";
import { renewalPriceSnapshot } from "./subscription-change.js";

/**
 * Служебные поводы подписки. Закрытый список принят в
 * [Notifications v1](../../../../../../docs/specifications/notifications-v1.md); Billing владеет
 * только фактом повода, а шаблон, канал и отправка принадлежат Notifications.
 */
export const noticeKinds = [
  "renewal_reminder",
  "access_ending",
  "payment_succeeded",
  "payment_failed",
  "renewal_cancelled",
  "access_expired",
  "refund_resolved",
] as const;
export const noticeKindSchema = z.enum(noticeKinds);
export type NoticeKind = z.infer<typeof noticeKindSchema>;
/** История покупок показывает поводы оплаты и подписки; окончание подарка к ним не относится. */
export const cabinetNoticeKindSchema = noticeKindSchema.exclude([
  "access_ending",
]);
export const noticeStateSchema = z.enum(["current", "superseded"]);

/** Страница кабинета, на которую ведёт служебное сообщение; origin принадлежит Notifications. */
export const BILLING_CABINET_PATH = "/account/purchases";
/**
 * Продление неоплаченного доступа: витрина показывает Account те Offer, которые ему продаются, в
 * том числе Offer «только по приглашению» после погашённого приглашения.
 */
export const ACCESS_RENEWAL_PATH = "/subscription";
/** Напоминание о списании создаётся за три дня до даты списания. */
export const RENEWAL_REMINDER_LEAD_MS = 3 * 24 * 60 * 60 * 1_000;
/** Напоминание об окончании неоплаченного доступа приходит с тем же упреждением, что и о списании. */
export const ACCESS_ENDING_LEAD_MS = RENEWAL_REMINDER_LEAD_MS;
/** Через сутки после самого события служебное сообщение перестаёт быть актуальным. */
export const NOTICE_LIFETIME_MS = 24 * 60 * 60 * 1_000;

/**
 * Выбор полей события своего источника. Полную неизменяемую форму провода проверяет AJV на
 * границе транспорта, поэтому момент здесь читается так же терпимо, как в принятом контракте.
 */
export const noticeEventSchema = z.strictObject({
  contractVersion: z.literal("inside.notification-event.v1"),
  messageId: idSchema,
  occurrenceRef: idSchema,
  sourceRef: z.string().min(1).max(128),
  sourceRevision: revisionSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  notAfter: z.iso.datetime({ offset: true }),
  eventType: z.literal("billing.notice-ready"),
  accountRef: idSchema,
  kind: noticeKindSchema,
});
export type NoticeEvent = z.infer<typeof noticeEventSchema>;

/** Кабинетное представление повода: без текста сообщения, получателей и данных провайдера. */
export const noticeViewSchema = z.strictObject({
  noticeRef: idSchema,
  kind: cabinetNoticeKindSchema,
  state: noticeStateSchema,
  occurredAt: z.iso.datetime(),
  amountKopecks: moneySchema.nullable(),
  dueAt: z.iso.datetime().nullable(),
});
export type NoticeView = z.infer<typeof noticeViewSchema>;

/** Что именно обещано получателю: название операции и, если они есть, сумма и дата. */
export interface NoticeConditions {
  readonly title: string;
  readonly amountKopecks?: number | undefined;
  readonly dueAt?: Date | undefined;
}
export interface NoticeOccurrence extends NoticeConditions {
  readonly kind: NoticeKind;
  readonly accountId: string;
  readonly sourceRef: string;
  readonly occurredAt: Date;
  readonly notAfter: Date;
  readonly subscriptionRef?: string | undefined;
  readonly attemptRef?: string | undefined;
}
/** Строка повода в условия: пустой столбец и отсутствие значения — одно и то же обещание. */
export function noticeConditions(row: {
  title: string;
  amountKopecks: bigint | null;
  dueAt: Date | null;
}): NoticeConditions {
  return {
    title: row.title,
    ...(row.amountKopecks === null
      ? {}
      : { amountKopecks: Number(row.amountKopecks) }),
    ...(row.dueAt === null ? {} : { dueAt: row.dueAt }),
  };
}
export function sameNoticeConditions(
  left: NoticeConditions,
  right: NoticeConditions,
): boolean {
  return (
    left.title === right.title &&
    left.amountKopecks === right.amountKopecks &&
    left.dueAt?.getTime() === right.dueAt?.getTime()
  );
}

/** Повод конкретной попытки: успех и отказ одной попытки — разные поводы одного платежа. */
export function attemptSourceRef(attemptRef: string): string {
  return `payment:${idSchema.parse(attemptRef)}`;
}
/** Один повод на попытку возврата: частичные возвраты одного платежа сообщаются каждый. */
export function refundSourceRef(refundRef: string): string {
  return `refund:${idSchema.parse(refundRef)}`;
}
/** Один повод на предстоящий период: продление сдвигает период и создаёт следующий повод. */
export function renewalReminderSourceRef(
  subscriptionRef: string,
  periodIndex: number,
): string {
  return `subscription:${idSchema.parse(subscriptionRef)}:period:${revisionSchema.parse(periodIndex)}`;
}
export function subscriptionEndedSourceRef(subscriptionRef: string): string {
  return `subscription:${idSchema.parse(subscriptionRef)}:ended`;
}
export function renewalCancelledSourceRef(
  subscriptionRef: string,
  revision: number,
): string {
  return `subscription:${idSchema.parse(subscriptionRef)}:canceled:${revisionSchema.parse(revision)}`;
}

/**
 * Поводы окончания Enrollment: напоминание считает свои циклы, потому что перенос срока внутри окна
 * продолжает то же напоминание, а окончание привязано к самой границе.
 */
export function accessEndingCyclesPrefix(enrollmentId: string): string {
  return `enrollment:${idSchema.parse(enrollmentId)}:ending:`;
}
export function accessEndingSourceRef(
  enrollmentId: string,
  cycle: number,
): string {
  return `${accessEndingCyclesPrefix(enrollmentId)}${String(revisionSchema.parse(cycle))}`;
}
export function accessEndedSourceRef(
  enrollmentId: string,
  endsAt: Date,
): string {
  return `enrollment:${idSchema.parse(enrollmentId)}:ended:${String(endsAt.getTime())}`;
}
const enrollmentNoticePattern =
  /^enrollment:([0-9a-f-]{36}):(?:ending|ended):\d+$/u;
/** Enrollment, о котором повод, или `undefined` для поводов оплаты и подписки. */
export function enrollmentOfNotice(sourceRef: string): string | undefined {
  return enrollmentNoticePattern.exec(sourceRef)?.[1];
}
/** Повод об Enrollment ведёт на продление, остальные поводы — в кабинет покупок. */
export function noticeReaderPath(kind: NoticeKind, sourceRef: string): string {
  return kind === "access_ending" || enrollmentOfNotice(sourceRef) !== undefined
    ? ACCESS_RENEWAL_PATH
    : BILLING_CABINET_PATH;
}

/** Событие описывает конкретную revision повода: повтор той же revision сохраняет messageId. */
export function noticeEvent(input: {
  readonly messageId: string;
  readonly occurrenceRef: string;
  readonly sourceRevision: number;
  readonly occurrence: NoticeOccurrence;
}): NoticeEvent {
  const { occurrence } = input;
  if (occurrence.occurredAt >= occurrence.notAfter)
    throw new Error("notice_window_invalid");
  return noticeEventSchema.parse({
    contractVersion: "inside.notification-event.v1",
    messageId: input.messageId,
    occurrenceRef: input.occurrenceRef,
    sourceRef: occurrence.sourceRef,
    sourceRevision: input.sourceRevision,
    occurredAt: occurrence.occurredAt.toISOString(),
    notAfter: occurrence.notAfter.toISOString(),
    eventType: "billing.notice-ready",
    accountRef: occurrence.accountId,
    kind: occurrence.kind,
  });
}

/** Повод самого события: срок жизни считается от того, когда оно произошло, а не когда замечено. */
export function lifecycleWindow(occurredAt: Date): {
  occurredAt: Date;
  notAfter: Date;
} {
  return {
    occurredAt,
    notAfter: new Date(occurredAt.getTime() + NOTICE_LIFETIME_MS),
  };
}

/** Предстоящее списание в доменных значениях: строка подписки остаётся у своего владельца. */
export interface RenewalReminderSubject {
  readonly subscriptionRef: string;
  readonly accountId: string;
  /** Расписание действует, и списать есть чем: без этого предстоящего списания нет. */
  readonly scheduled: boolean;
  readonly snapshot: unknown;
  readonly pendingChange: unknown;
  readonly paidUntil: Date;
  readonly nextPeriodIndex: number;
}

/**
 * Напоминание относится только к предстоящему списанию действующего расписания: отменённая
 * подписка, отозванная привязка и уже наступившая дата не дают повода. Дата, сумма и название
 * берутся из принятых условий следующего периода, а не из текущего каталога.
 */
export function planRenewalReminder(
  subject: RenewalReminderSubject,
  now: Date,
): NoticeOccurrence | undefined {
  if (!subject.scheduled) return undefined;
  if (
    subject.paidUntil <= now ||
    subject.paidUntil.getTime() - now.getTime() > RENEWAL_REMINDER_LEAD_MS
  )
    return undefined;
  const snapshot = renewalPriceSnapshot(
    subject.snapshot,
    subject.pendingChange,
  );
  return {
    kind: "renewal_reminder",
    accountId: subject.accountId,
    sourceRef: renewalReminderSourceRef(
      subject.subscriptionRef,
      subject.nextPeriodIndex,
    ),
    subscriptionRef: subject.subscriptionRef,
    title: snapshot.offer.name,
    amountKopecks: moneySchema.parse(snapshot.renewalPriceKopecks),
    occurredAt: now,
    notAfter: subject.paidUntil,
    dueAt: subject.paidUntil,
  };
}

/**
 * Конечный неоплаченный доступ в доменных значениях: подарок, ручное назначение и любое другое
 * Enrollment с фиксированным концом. Строка Enrollment остаётся у Membership Entitlements.
 */
export interface AccessEndingSubject {
  readonly enrollmentId: string;
  readonly accountId: string;
  readonly title: string;
  readonly endsAt: Date;
  /** Другое основание Account действует после границы: доступ на ней не заканчивается. */
  readonly continued: boolean;
}

/**
 * Напоминание за три дня до границы. Повод живёт до самой границы: позже напоминать уже не о чем,
 * а об окончании сообщает отдельный повод.
 */
export function planAccessEnding(
  subject: AccessEndingSubject,
  sourceRef: string,
  now: Date,
): NoticeOccurrence | undefined {
  if (
    subject.continued ||
    subject.endsAt <= now ||
    subject.endsAt.getTime() - now.getTime() > ACCESS_ENDING_LEAD_MS
  )
    return undefined;
  return {
    kind: "access_ending",
    accountId: subject.accountId,
    sourceRef,
    title: subject.title,
    occurredAt: now,
    notAfter: subject.endsAt,
    dueAt: subject.endsAt,
  };
}

/**
 * Окончание сообщается с момента самой границы. Граница, замеченная позже срока жизни повода,
 * новостью уже не является; продление до границы повода не оставляет вовсе.
 */
export function planAccessEnded(
  subject: AccessEndingSubject,
  now: Date,
): NoticeOccurrence | undefined {
  if (
    subject.continued ||
    subject.endsAt > now ||
    now.getTime() - subject.endsAt.getTime() >= NOTICE_LIFETIME_MS
  )
    return undefined;
  return {
    kind: "access_expired",
    accountId: subject.accountId,
    sourceRef: accessEndedSourceRef(subject.enrollmentId, subject.endsAt),
    title: subject.title,
    dueAt: subject.endsAt,
    ...lifecycleWindow(subject.endsAt),
  };
}

/**
 * Перенос срока не повторяет напоминание: новая граница в пределах окна прежней остаётся тем же
 * поводом. Продление дальше окна начинает следующий цикл, и о новой границе напомнят снова.
 */
export function continuesAccessEndingReminder(
  previousDueAt: Date,
  endsAt: Date,
): boolean {
  return endsAt.getTime() - previousDueAt.getTime() <= ACCESS_ENDING_LEAD_MS;
}
