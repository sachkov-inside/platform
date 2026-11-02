import { z } from "zod";
import { idSchema, moneySchema, revisionSchema } from "./pricing.js";

/**
 * Stored payment notices, including passive historical kinds. The closed wire list belongs to
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
  "sale_recorded",
] as const;
export const noticeKindSchema = z.enum(noticeKinds);
export type NoticeKind = z.infer<typeof noticeKindSchema>;
/**
 * Purchase history retains stored notice kinds without resuming retired schedules. Повод продажи
 * адресован авторам, а не покупателю, поэтому в историю покупок не входит.
 */
export const cabinetNoticeKindSchema = noticeKindSchema.exclude([
  "access_ending",
  "sale_recorded",
]);
export const noticeStateSchema = z.enum(["current", "superseded"]);

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

/** Скидка проданной покупки в том виде, в каком она применилась к оплате. */
export const salePromotionSchema = z.strictObject({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(100).nullable(),
  percent: z.int().min(1).max(100),
});
export type SalePromotion = z.infer<typeof salePromotionSchema>;

/** Что именно обещано получателю: название операции и, если они есть, сумма, дата и скидка. */
export interface NoticeConditions {
  readonly title: string;
  readonly amountKopecks?: number | undefined;
  readonly dueAt?: Date | undefined;
  readonly promotion?: SalePromotion | undefined;
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
  promotion: unknown;
}): NoticeConditions {
  return {
    title: row.title,
    ...(row.amountKopecks === null
      ? {}
      : { amountKopecks: Number(row.amountKopecks) }),
    ...(row.dueAt === null ? {} : { dueAt: row.dueAt }),
    ...(row.promotion === null
      ? {}
      : { promotion: salePromotionSchema.parse(row.promotion) }),
  };
}
export function sameNoticeConditions(
  left: NoticeConditions,
  right: NoticeConditions,
): boolean {
  return (
    left.title === right.title &&
    left.amountKopecks === right.amountKopecks &&
    left.dueAt?.getTime() === right.dueAt?.getTime() &&
    JSON.stringify(left.promotion ?? null) ===
      JSON.stringify(right.promotion ?? null)
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
/** Один повод продажи на покупку: повтор подтверждения банком сохраняет тот же повод. */
export function saleSourceRef(purchaseRef: string): string {
  return `sale:${idSchema.parse(purchaseRef)}`;
}
/**
 * Поводы окончания Enrollment: ключ начинается с него, у поводов оплаты и подписки — нет.
 * Напоминание считает свои циклы, потому что перенос срока внутри окна продолжает то же
 * напоминание, а окончание привязано к самой границе.
 */
export const ENROLLMENT_NOTICE_PREFIX = "enrollment:";
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
