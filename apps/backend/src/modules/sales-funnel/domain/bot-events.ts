import { z } from "zod";

export const SALES_FUNNEL_EVENTS_VERSION = "inside.sales-funnel-events.v1";
export const MAX_EVENTS_PER_DELIVERY = 100;

/** Метка источника из ссылки бота; `null` — вход по ссылке без метки. */
export const sourceCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u)
  .nullable();

const eventBase = {
  eventId: z.uuid().toLowerCase(),
  /** Непрозрачный стабильный идентификатор контакта бота, не Telegram user id. */
  contactRef: z.uuid().toLowerCase(),
  occurredAt: z.iso.datetime({ offset: true }),
};

export const botEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...eventBase,
    kind: z.literal("bot_entered"),
    sourceCode: sourceCodeSchema,
  }),
  z.strictObject({
    ...eventBase,
    kind: z.literal("marketing_consent"),
    granted: z.boolean(),
  }),
  z.strictObject({
    ...eventBase,
    kind: z.literal("account_linked"),
    /** Тот же ref, что в протоколе привязки Telegram; аккаунт Platform находит сама. */
    telegramIdentityRef: z.string().trim().min(1).max(256),
  }),
]);
export type BotEvent = z.infer<typeof botEventSchema>;

export const botEventDeliverySchema = z.strictObject({
  contractVersion: z.literal(SALES_FUNNEL_EVENTS_VERSION),
  events: z.array(botEventSchema).min(1).max(MAX_EVENTS_PER_DELIVERY),
});

export const botEventReceiptSchema = z.strictObject({
  contractVersion: z.literal(SALES_FUNNEL_EVENTS_VERSION),
  accepted: z.int().nonnegative(),
  duplicates: z.int().nonnegative(),
});
export type BotEventReceipt = z.infer<typeof botEventReceiptSchema>;

/** Колонки строки журнала: одно и то же событие сравнивается по ним при повторе. */
export function botEventColumns(event: BotEvent) {
  return {
    eventId: event.eventId,
    contactRef: event.contactRef,
    kind: event.kind,
    sourceCode: event.kind === "bot_entered" ? event.sourceCode : null,
    granted: event.kind === "marketing_consent" ? event.granted : null,
    telegramIdentityRef:
      event.kind === "account_linked" ? event.telegramIdentityRef : null,
    occurredAt: new Date(event.occurredAt),
  };
}
