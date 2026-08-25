import { sql } from "kysely";

import type { PlatformDatabase } from "../../../../../infrastructure/postgres/index.js";
import type { PublishedMaterialProjectionDto } from "../../../application/published-material-reader/published-material-reader.js";
import type { MaterialId } from "../../../domain/material-identifiers.js";

export interface PublishedMaterialCursor {
  readonly materialId: MaterialId;
  readonly publishedAt: Date;
}

export interface PublishedMaterialProjectionPage {
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly hasNext: boolean;
}

export async function selectPublishedMaterialProjectionBySlug(
  database: PlatformDatabase,
  slug: string,
): Promise<PublishedMaterialProjectionDto | undefined> {
  const row = await publishedMaterialProjectionQuery(database)
    .where("publication.slug", "=", slug)
    .executeTakeFirst();
  return row === undefined ? undefined : toProjection(row);
}

export async function selectPublishedMaterialProjectionPage(
  database: PlatformDatabase,
  values: {
    readonly after?: PublishedMaterialCursor;
    readonly first: number;
  },
): Promise<PublishedMaterialProjectionPage> {
  let query = publishedMaterialProjectionQuery(database);
  if (values.after !== undefined) {
    query = query.where(
      sql<boolean>`(publication.published_at, publication.material_id) < (${values.after.publishedAt}, ${values.after.materialId}::uuid)`,
    );
  }
  const rows = await query
    .orderBy("publication.published_at", "desc")
    .orderBy("publication.material_id", "desc")
    .limit(values.first + 1)
    .execute();
  return {
    items: rows.slice(0, values.first).map(toProjection),
    hasNext: rows.length > values.first,
  };
}

function publishedMaterialProjectionQuery(database: PlatformDatabase) {
  return database
    .selectFrom("materials.published_materials as publication")
    .innerJoin("materials.topics as topic", "topic.id", "publication.topic_id")
    .innerJoin("materials.formats as format", "format.id", "publication.format_id")
    .select([
      "publication.material_id",
      "publication.revision_id",
      "publication.slug",
      "publication.title",
      "publication.summary",
      "publication.access",
      "publication.published_at",
      "topic.id as topic_id",
      "topic.name as topic_name",
      "topic.slug as topic_slug",
      "format.id as format_id",
      "format.name as format_name",
      "format.slug as format_slug",
      sql<readonly { readonly id: string; readonly name: string }[]>`coalesce(
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
      )`.as("tags"),
      sql<
        readonly {
          readonly id: string;
          readonly name: string;
          readonly slug: string;
          readonly ordinal: number;
        }[]
      >`coalesce(
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
      )`.as("series_memberships"),
    ]);
}

function toProjection(
  row: Awaited<ReturnType<ReturnType<typeof publishedMaterialProjectionQuery>["executeTakeFirst"]>> &
    {},
): PublishedMaterialProjectionDto {
  if (row.access !== "free" && row.access !== "membership") {
    throw new TypeError("Published Material access is outside the application contract");
  }
  return {
    materialId: row.material_id,
    revisionId: row.revision_id,
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
    seriesMemberships: row.series_memberships.map(({ id, name, ordinal, slug }) => ({
      ordinal,
      series: { id, name, slug },
    })),
  };
}
