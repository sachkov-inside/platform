import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type MaterialsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

// A report selector lists every Guide at once; the bound only stops a runaway catalog.
const MAX_GUIDES = 200;

const rowsSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    chapters: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        materialIds: z.array(z.uuid()),
      }),
    ),
  }),
);

export type GuideOutline = z.infer<typeof rowsSchema>[number];
export type GuideOutlinesResult =
  | { readonly ok: true; readonly value: readonly GuideOutline[] }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "guides_too_many" | "dependency_unavailable";
      };
    };

/**
 * Current Guides with their chapters in author order and the published, reader-visible
 * Materials of each chapter: the same composition the Guide programme shows.
 */
export class GuideOutlines {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  async list(): Promise<GuideOutlinesResult> {
    try {
      const rows = rowsSchema.parse(
        await this.prisma.$queryRaw(Prisma.sql`
        select
          series.id,
          series.name,
          coalesce(
            (
              select json_agg(
                json_build_object(
                  'id', chapter.id,
                  'name', chapter.name,
                  'materialIds', coalesce(
                    (
                      select json_agg(published.material_id order by published.ordinal)
                      from materials.published_material_series_memberships as published
                      join materials.series_memberships as current_membership
                        on current_membership.series_id = published.series_id
                       and current_membership.material_id = published.material_id
                      join materials.published_materials as publication
                        on publication.material_id = published.material_id
                      where published.series_id = chapter.guide_id
                        and current_membership.chapter_id = chapter.id
                    ),
                    '[]'::json
                  )
                )
                order by chapter.ordinal, chapter.id
              )
              from materials.guide_chapters as chapter
              where chapter.guide_id = series.id
            ),
            '[]'::json
          ) as chapters
        from materials.series as series
        where series.archived_at is null
        order by series.name, series.id
        limit ${MAX_GUIDES + 1}
      `),
      );
      if (rows.length > MAX_GUIDES)
        return { ok: false, error: { code: "guides_too_many" } };
      return { ok: true, value: rows };
    } catch (error) {
      return dependencyFailure(
        { module: "materials", operation: "listGuideOutlines" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }
}
