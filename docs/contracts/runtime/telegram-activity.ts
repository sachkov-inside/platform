import { z } from "zod";

export const TELEGRAM_ACTIVITY_ROW_LIMIT = 10_000;
export const TELEGRAM_ACTIVITY_RETENTION_MS: number = 365 * 86_400_000;
export interface TelegramActivityWindow { readonly from: string; readonly to: string }
export interface TelegramActivityCoverage {
 readonly status: "partial"; readonly collectionStartedAt: string | null;
 readonly continuity: "not_proven"; readonly retentionFrom: string;
}
export interface TelegramActivitySnapshot {
 readonly contractVersion: "inside.telegram-activity.v1";
 readonly window: TelegramActivityWindow; readonly asOf: string;
 readonly coverage: TelegramActivityCoverage; readonly attribution: "current_confirmed_link";
 readonly accountIds: readonly string[]; readonly unlinkedContacts: number;
}
export type TelegramActivityResult =
 | { readonly ok: true; readonly value: TelegramActivitySnapshot }
 | { readonly ok: false; readonly error: { readonly code: "invalid_request" | "outside_retention" | "outside_collection" | "source_unavailable" | "source_budget_exceeded" } };
const windowFields = { from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) };
export const telegramActivityWindowSchema: z.ZodType<TelegramActivityWindow> = z.strictObject(windowFields).refine(({ from, to }) => {
 const duration = Date.parse(to) - Date.parse(from);
 return duration > 0 && duration <= 31 * 86_400_000;
});
export const telegramActivityRequestSchema: z.ZodType<TelegramActivityWindow & { contractVersion: "inside.telegram-activity.v1" }> = z.strictObject({
 contractVersion: z.literal("inside.telegram-activity.v1"), ...windowFields,
}).refine(({ from, to }) => telegramActivityWindowSchema.safeParse({ from, to }).success);
export const telegramActivityCoverageSchema: z.ZodType<TelegramActivityCoverage> = z.strictObject({
 status: z.literal("partial"), collectionStartedAt: z.iso.datetime({ offset: true }).nullable(),
 continuity: z.literal("not_proven"), retentionFrom: z.iso.datetime({ offset: true }),
});
export const telegramActivitySnapshotSchema: z.ZodType<TelegramActivitySnapshot> = z.strictObject({
 contractVersion: z.literal("inside.telegram-activity.v1"), window: telegramActivityWindowSchema,
 asOf: z.iso.datetime({ offset: true }), coverage: telegramActivityCoverageSchema,
 attribution: z.literal("current_confirmed_link"),
 accountIds: z.array(z.uuid().transform(value => value.toLowerCase())).max(TELEGRAM_ACTIVITY_ROW_LIMIT),
 unlinkedContacts: z.number().int().nonnegative().max(TELEGRAM_ACTIVITY_ROW_LIMIT),
});
export const telegramActivityResultSchema: z.ZodType<TelegramActivityResult> = z.discriminatedUnion("ok", [
 z.strictObject({ ok: z.literal(true), value: telegramActivitySnapshotSchema }),
 z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.enum(["invalid_request", "outside_retention", "outside_collection", "source_unavailable", "source_budget_exceeded"]) }) }),
]);
export interface TelegramActivitySource { read(window: TelegramActivityWindow): Promise<TelegramActivityResult> }
