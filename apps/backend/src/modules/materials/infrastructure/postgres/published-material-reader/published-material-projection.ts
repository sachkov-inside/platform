import {
  Prisma,
  type MaterialsPrisma,
} from "../../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import type { MaterialId } from "../../../domain/material-identifiers.js";
import type { PublishedMaterialProjectionDto } from "../../../facets/published-material-reader/published-material.contract.js";

export interface PublishedMaterialCursor {
  readonly materialId: MaterialId;
  readonly publishedAt: Date;
}

export interface PublishedMaterialProjectionPage {
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly hasNext: boolean;
}

const publishedMaterialProjectionRowSchema = z.object({
  material_id: z.uuid(),
  content_version: z.coerce.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  access: z.enum(["free", "membership"]),
  published_at: z.date(),
  topic_id: z.uuid(),
  topic_name: z.string(),
  topic_slug: z.string(),
  format_id: z.uuid(),
  format_name: z.string(),
  format_slug: z.string(),
  tags: z.array(z.object({ id: z.uuid(), name: z.string() })),
  series_memberships: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
      ordinal: z.number().int(),
    }),
  ),
});

type PublishedMaterialProjectionRow = z.infer<
  typeof publishedMaterialProjectionRowSchema
>;

export async function selectPublishedMaterialProjectionBySlug(
  prisma: MaterialsPrisma,
  slug: string,
): Promise<PublishedMaterialProjectionDto | undefined> {
  const rows = publishedMaterialProjectionRowSchema.array().parse(
    await prisma.$queryRaw(
      projectionQuery(
        Prisma.sql`where publication.slug = ${slug}`,
        Prisma.sql`limit 1`,
      ),
    ),
  );
  return rows[0] === undefined ? undefined : toProjection(rows[0]);
}

export async function selectPublishedMaterialProjectionPage(
  prisma: MaterialsPrisma,
  values: {
    readonly after?: PublishedMaterialCursor;
    readonly first: number;
  },
): Promise<PublishedMaterialProjectionPage> {
  const cursor =
    values.after === undefined
      ? Prisma.empty
      : Prisma.sql`
          where (publication.published_at, publication.material_id)
            < (${values.after.publishedAt}, ${values.after.materialId}::uuid)
        `;
  const rows = publishedMaterialProjectionRowSchema.array().parse(
    await prisma.$queryRaw(
      projectionQuery(cursor, Prisma.sql`limit ${values.first + 1}`),
    ),
  );
  return {
    items: rows.slice(0, values.first).map(toProjection),
    hasNext: rows.length > values.first,
  };
}

function projectionQuery(where: Prisma.Sql, limit: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    select
      publication.material_id,
      publication.content_version,
      publication.slug,
      publication.title,
      publication.summary,
      publication.access,
      publication.published_at,
      topic.id as topic_id,
      topic.name as topic_name,
      topic.slug as topic_slug,
      format.id as format_id,
      format.name as format_name,
      format.slug as format_slug,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', tag.id, 'name', tag.name)
            order by tag.normalized_name
          )
          from materials.published_material_tags as membership
          join materials.tags as tag on tag.id = membership.tag_id
          where membership.material_id = publication.material_id
        ),
        '[]'::jsonb
      ) as tags,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', series.id,
              'name', series.name,
              'slug', series.slug,
              'ordinal', membership.ordinal
            )
            order by series.name, membership.ordinal
          )
          from materials.published_material_series_memberships as membership
          join materials.series on series.id = membership.series_id
          where membership.material_id = publication.material_id
        ),
        '[]'::jsonb
      ) as series_memberships
    from materials.published_materials as publication
    join materials.topics as topic on topic.id = publication.topic_id
    join materials.formats as format on format.id = publication.format_id
    ${where}
    order by publication.published_at desc, publication.material_id desc
    ${limit}
  `;
}

function toProjection(
  row: PublishedMaterialProjectionRow,
): PublishedMaterialProjectionDto {
  return {
    materialId: row.material_id,
    contentVersion: row.content_version,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    access: row.access,
    publishedAt: row.published_at.toISOString(),
    topic: {
      id: row.topic_id,
      name: row.topic_name,
      slug: row.topic_slug,
    },
    format: {
      id: row.format_id,
      name: row.format_name,
      slug: row.format_slug,
    },
    tags: row.tags,
    seriesMemberships: row.series_memberships.map(
      ({ id, name, ordinal, slug }) => ({
        ordinal,
        series: { id, name, slug },
      }),
    ),
  };
}
