import { z } from "zod";
import { Prisma, type MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";

// Return one bounded composition snapshot; never silently truncate progress.
const MAX_SERIES_MATERIALS = 10_000;
const rowSchema = z.array(z.object({ material_id: z.uuid().nullable() }));
export type PublishedSeriesCompositionResult =
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly error:
      | { readonly code: "invalid_request" }
      | { readonly code: "series_not_found" }
      | { readonly code: "series_too_large" }
      | { readonly code: "dependency_unavailable" } };

export class PublishedSeriesComposition {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  async read(seriesId: string): Promise<PublishedSeriesCompositionResult> {
    if (!z.uuid().safeParse(seriesId).success) return { ok: false, error: { code: "invalid_request" } };
    try {
      const rows = rowSchema.parse(await this.prisma.$queryRaw(Prisma.sql`
        SELECT membership.material_id
        FROM materials.series AS series
        LEFT JOIN materials.published_material_series_memberships AS membership ON membership.series_id = series.id
        WHERE series.id = ${seriesId}::uuid AND series.archived_at IS NULL
        LIMIT ${MAX_SERIES_MATERIALS + 1}
      `));
      if (rows.length === 0) return { ok: false, error: { code: "series_not_found" } };
      if (rows.length > MAX_SERIES_MATERIALS) return { ok: false, error: { code: "series_too_large" } };
      return { ok: true, value: rows.flatMap((row) => row.material_id === null ? [] : [row.material_id]) };
    } catch {
      return { ok: false, error: { code: "dependency_unavailable" } };
    }
  }
}
