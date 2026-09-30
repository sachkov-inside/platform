import { z } from "zod";

// Query strings arrive as text; the instants are the period bounds `[from, to)`.
export const funnelReportQuerySchema = z.strictObject({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  guideId: z.uuid().toLowerCase().optional(),
  chapterId: z.uuid().toLowerCase().optional(),
});
export type FunnelReportQuery = z.infer<typeof funnelReportQuerySchema>;

const countSchema = z.int().nonnegative();

/**
 * Where a person came from. `label` is the source label of the bot link they first entered
 * through, `unlabelled` a first bot entry without one, and `outside_bot` an Account with no known
 * bot entry.
 */
export const funnelSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("label"), code: z.string() }),
  z.strictObject({ kind: z.literal("unlabelled") }),
  z.strictObject({ kind: z.literal("outside_bot") }),
]);
export type FunnelSource = z.infer<typeof funnelSourceSchema>;

/**
 * One count per funnel step. `null` means the step does not apply or cannot be measured for
 * this selection, never zero: the bot steps do not exist outside the bot, and the Platform steps
 * need a selected Guide and chapter.
 */
export const funnelCountsSchema = z.strictObject({
  entered: countSchema.nullable(),
  consented: countSchema.nullable(),
  openedChapter: countSchema.nullable(),
  checkout: countSchema.nullable(),
  paid: countSchema.nullable(),
});
export type FunnelCounts = z.infer<typeof funnelCountsSchema>;

export const funnelReportSchema = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  period: z.strictObject({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  }),
  guides: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      chapters: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
    }),
  ),
  selection: z
    .strictObject({ guideId: z.uuid(), chapterId: z.uuid().nullable() })
    .nullable(),
  /** When the bot's latest event reached Platform; null when none has yet. */
  lastBotEventReceivedAt: z.iso.datetime({ offset: true }).nullable(),
  rows: z.array(
    z.strictObject({ source: funnelSourceSchema, counts: funnelCountsSchema }),
  ),
  total: funnelCountsSchema,
});
export type FunnelReport = z.infer<typeof funnelReportSchema>;

export type FunnelReportErrorCode =
  | "invalid_request"
  | "forbidden"
  | "guide_not_found"
  | "chapter_not_found"
  | "dependency_unavailable";

export type FunnelReportResult =
  | { readonly ok: true; readonly value: FunnelReport }
  | {
      readonly ok: false;
      readonly error: { readonly code: FunnelReportErrorCode };
    };
