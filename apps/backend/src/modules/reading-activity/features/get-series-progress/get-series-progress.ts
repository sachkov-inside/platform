import { z } from "zod";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { PublishedSeriesComposition, PublishedSeriesCompositionResult } from "../../../materials/index.js";

const querySchema = z.object({ accountId: z.uuid(), seriesId: z.uuid() }).strict();
export const seriesProgressSchema = z.object({
  seriesId: z.uuid(), read: z.number().int().nonnegative(), total: z.number().int().nonnegative(), allRead: z.boolean(),
}).strict();
export type GetSeriesProgressResult =
  | { readonly ok: true; readonly value: z.infer<typeof seriesProgressSchema> }
  | Extract<PublishedSeriesCompositionResult, { readonly ok: false }>;

export async function getSeriesProgress(dependencies: {
  readonly prisma: ReadingActivityPrismaClient;
  readonly composition: Pick<PublishedSeriesComposition, "read">;
}, input: { readonly accountId: string; readonly seriesId: string }): Promise<GetSeriesProgressResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  try {
    const composition = await dependencies.composition.read(parsed.data.seriesId);
    if (!composition.ok) return composition;
    const total = composition.value.length;
    const read = await dependencies.prisma.readingMaterialState.count({
      where: { accountId: parsed.data.accountId, materialId: { in: [...composition.value] }, isRead: true },
    });
    return { ok: true, value: { seriesId: parsed.data.seriesId.toLowerCase(), total, read, allRead: total > 0 && total === read } };
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
