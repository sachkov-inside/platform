import { z } from "zod";
import {
  Prisma,
  type MaterialsPrisma,
} from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { normalizedUuidSchema } from "../../domain/uuid.js";
import { materialFormatsSql } from "../../infrastructure/postgres/material-formats.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type { ListPublishedSiteMaterialsOperation } from "./list-published-site-materials.contract.js";

const querySchema = z
  .object({
    first: z.number().int().min(1).max(200),
    after: z
      .object({
        materialId: normalizedUuidSchema,
        publishedAt: z.iso.datetime({ offset: true }),
      })
      .strict()
      .optional(),
  })
  .strict();
const rowsSchema = z.array(
  z.object({
    material_id: normalizedUuidSchema,
    slug: z.string().min(1),
    published_at: z.date(),
  }),
);
const slugsSchema = z.array(z.object({ slug: z.string().min(1) }));

/** Sitemap enumeration does not project previews, viewer availability, covers or counts. */
export function assembleListPublishedSiteMaterials(
  prisma: MaterialsPrisma,
): ListPublishedSiteMaterialsOperation {
  return async (query) => {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request_shape" } };
    const { after, first } = parsed.data;
    try {
      const rows = rowsSchema.parse(
        await prisma.$queryRaw(Prisma.sql`
        select publication.material_id, publication.slug, publication.published_at
        from materials.published_materials as publication
        join materials.topics as topic on topic.id = publication.topic_id
        join (${materialFormatsSql}) as format(id, slug, name) on format.id = publication.format_id
        ${after === undefined ? Prisma.empty : Prisma.sql`where (publication.published_at, publication.material_id) < (${new Date(after.publishedAt)}, ${after.materialId}::uuid)`}
        order by publication.published_at desc, publication.material_id desc
        limit ${first + 1}
      `),
      );
      const page = rows.slice(0, first);
      const last = page.at(-1);
      let productSlugs: readonly string[] = [];
      let topicSlugs: readonly string[] = [];
      if (after === undefined) {
        topicSlugs = slugsSchema
          .parse(
            await prisma.$queryRaw(Prisma.sql`
          select topic.slug from materials.topics as topic
          where topic.archived_at is null and exists (
            select 1 from materials.published_materials as publication
            join (${materialFormatsSql}) as format(id, slug, name) on format.id = publication.format_id
            where publication.topic_id = topic.id
          ) order by topic.name, topic.id
        `),
          )
          .map(({ slug }) => slug);
        productSlugs = slugsSchema
          .parse(
            await prisma.$queryRaw(Prisma.sql`
          select series.slug from materials.series as series
          where series.archived_at is null and exists (
            select 1 from materials.published_material_series_memberships as membership
            join materials.published_materials as publication on publication.material_id = membership.material_id
            join materials.topics as topic on topic.id = publication.topic_id
            join (${materialFormatsSql}) as format(id, slug, name) on format.id = publication.format_id
            where membership.series_id = series.id
          ) order by series.name, series.id
        `),
          )
          .map(({ slug }) => slug);
      }
      return {
        ok: true,
        value: {
          items: page.map(({ slug, published_at }) => ({
            slug,
            publishedAt: published_at.toISOString(),
          })),
          productSlugs,
          topicSlugs,
          continuation:
            rows.length > first && last !== undefined
              ? {
                  materialId: last.material_id,
                  publishedAt: last.published_at.toISOString(),
                }
              : null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "listPublishedSiteMaterials" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}
