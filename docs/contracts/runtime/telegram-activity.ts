import { z } from "zod";

export const TELEGRAM_ACTIVITY_ROW_LIMIT = 10_000;
export const TELEGRAM_ACTIVITY_RETENTION_MS: number = 365 * 86_400_000;

export const telegramActivityWindowSchema: z.ZodObject<{
  from: z.ZodISODateTime;
  to: z.ZodISODateTime;
}, z.core.$strict> = z.strictObject({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
}).refine(({ from, to }) => {
  const duration = Date.parse(to) - Date.parse(from);
  return duration > 0 && duration <= 31 * 86_400_000;
});
export type TelegramActivityWindow = z.infer<typeof telegramActivityWindowSchema>;

export const telegramActivityRequestSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.telegram-activity.v1">;
  from: z.ZodISODateTime;
  to: z.ZodISODateTime;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.telegram-activity.v1"),
  ...telegramActivityWindowSchema.shape,
}).refine(({ from, to }) => telegramActivityWindowSchema.safeParse({ from, to }).success);

export const telegramActivityCoverageSchema: z.ZodObject<{
  status: z.ZodLiteral<"partial">;
  collectionStartedAt: z.ZodNullable<z.ZodISODateTime>;
  continuity: z.ZodLiteral<"not_proven">;
  retentionFrom: z.ZodISODateTime;
}, z.core.$strict> = z.strictObject({
  status: z.literal("partial"),
  collectionStartedAt: z.iso.datetime({ offset: true }).nullable(),
  continuity: z.literal("not_proven"),
  retentionFrom: z.iso.datetime({ offset: true }),
});
export type TelegramActivityCoverage = z.infer<typeof telegramActivityCoverageSchema>;

export const telegramActivitySnapshotSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.telegram-activity.v1">;
  window: typeof telegramActivityWindowSchema;
  asOf: z.ZodISODateTime;
  coverage: typeof telegramActivityCoverageSchema;
  attribution: z.ZodLiteral<"current_confirmed_link">;
  accountIds: z.ZodArray<z.ZodUUID>;
  unlinkedContacts: z.ZodNumber;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.telegram-activity.v1"),
  window: telegramActivityWindowSchema,
  asOf: z.iso.datetime({ offset: true }),
  coverage: telegramActivityCoverageSchema,
  attribution: z.literal("current_confirmed_link"),
  accountIds: z.array(z.uuid().toLowerCase()).max(TELEGRAM_ACTIVITY_ROW_LIMIT),
  unlinkedContacts: z.number().int().nonnegative().max(TELEGRAM_ACTIVITY_ROW_LIMIT),
});
export type TelegramActivitySnapshot = z.infer<typeof telegramActivitySnapshotSchema>;

const successSchema: z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: typeof telegramActivitySnapshotSchema;
}, z.core.$strict> = z.strictObject({ ok: z.literal(true), value: telegramActivitySnapshotSchema });
const failureSchema: z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      invalid_request: "invalid_request";
      outside_retention: "outside_retention";
      outside_collection: "outside_collection";
      source_unavailable: "source_unavailable";
      source_budget_exceeded: "source_budget_exceeded";
    }>;
  }, z.core.$strict>;
}, z.core.$strict> = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({ code: z.enum(["invalid_request", "outside_retention", "outside_collection", "source_unavailable", "source_budget_exceeded"]) }),
});
export const telegramActivityResultSchema: z.ZodDiscriminatedUnion<[
  typeof successSchema,
  typeof failureSchema,
], "ok"> = z.discriminatedUnion("ok", [successSchema, failureSchema]);
export type TelegramActivityResult = z.infer<typeof telegramActivityResultSchema>;

export interface TelegramActivitySource {
  read(window: TelegramActivityWindow): Promise<TelegramActivityResult>;
}
