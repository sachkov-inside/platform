import { sql } from "kysely";

import type { PublicMaterialProjectionDto } from "../../application/published-material-reader.interface.js";
import type { MaterialBodyExtraction } from "../../domain/material-body/material-body.js";
import type { MaterialRevision } from "../../domain/material.js";
import {
  materialId,
  materialRevisionId,
  type MaterialId,
  type MaterialRevisionId,
} from "../../domain/material-identifiers.js";
import type { AuthoringDatabase, AuthoringTransaction } from "./database.js";

export interface PublicationEvent {
  readonly id: string;
  readonly materialId: MaterialId;
  readonly revisionId: MaterialRevisionId;
  readonly createdAt: Date;
}

export async function loadPublicationEvent(
  database: AuthoringDatabase,
  eventId: string,
): Promise<PublicationEvent | undefined> {
  const event = await database
    .selectFrom("materials.material_publication_events")
    .select(["id", "material_id", "revision_id", "created_at"])
    .where("id", "=", eventId)
    .executeTakeFirst();
  return event === undefined
    ? undefined
    : {
        id: event.id,
        materialId: materialId(event.material_id),
        revisionId: materialRevisionId(event.revision_id),
        createdAt: event.created_at,
      };
}

export async function hasPublicationEvent(
  database: AuthoringDatabase,
  materialIdValue: MaterialId,
  revisionId: MaterialRevisionId,
): Promise<boolean> {
  const event = await database
    .selectFrom("materials.material_publication_events")
    .select("id")
    .where("material_id", "=", materialIdValue)
    .where("revision_id", "=", revisionId)
    .where("kind", "=", "publish")
    .executeTakeFirst();
  return event !== undefined;
}

export async function publishRevisionProjection(
  transaction: AuthoringTransaction,
  values: {
    readonly actor: string;
    readonly eventId: string;
    readonly extraction: MaterialBodyExtraction;
    readonly revision: MaterialRevision;
  },
): Promise<PublicationEvent> {
  const { metadata } = values.revision;
  const event = await transaction
    .insertInto("materials.material_publication_events")
    .values({
      id: values.eventId,
      material_id: values.revision.materialId,
      revision_id: values.revision.id,
      kind: "publish",
      actor_id: values.actor,
    })
    .returning(["id", "material_id", "revision_id", "created_at"])
    .executeTakeFirstOrThrow();

  await transaction
    .updateTable("materials.materials")
    .set({ current_published_revision_id: values.revision.id })
    .where("id", "=", values.revision.materialId)
    .executeTakeFirstOrThrow();

  // The search row references the exact published revision. Remove it before
  // replacing that revision, then recreate it below in the same transaction.
  await transaction
    .deleteFrom("materials.material_search_documents")
    .where("material_id", "=", values.revision.materialId)
    .execute();

  await transaction
    .insertInto("materials.published_materials")
    .values({
      material_id: values.revision.materialId,
      revision_id: values.revision.id,
      slug: metadata.slug,
      title: metadata.title,
      summary: metadata.summary,
      access: metadata.access,
      topic_id: metadata.topicId,
      format_id: metadata.formatId,
      published_by: values.actor,
      published_at: event.created_at,
    })
    .onConflict((conflict) =>
      conflict.column("material_id").doUpdateSet({
        revision_id: values.revision.id,
        slug: metadata.slug,
        title: metadata.title,
        summary: metadata.summary,
        access: metadata.access,
        topic_id: metadata.topicId,
        format_id: metadata.formatId,
        published_by: values.actor,
        published_at: event.created_at,
      }),
    )
    .execute();

  await transaction
    .deleteFrom("materials.published_material_tags")
    .where("material_id", "=", values.revision.materialId)
    .execute();
  if (metadata.tagIds.length > 0) {
    await transaction
      .insertInto("materials.published_material_tags")
      .values(
        metadata.tagIds.map((tagId) => ({
          material_id: values.revision.materialId,
          tag_id: tagId,
        })),
      )
      .execute();
  }

  await transaction
    .deleteFrom("materials.published_material_series_memberships")
    .where("material_id", "=", values.revision.materialId)
    .execute();
  if (metadata.seriesMemberships.length > 0) {
    await transaction
      .insertInto("materials.published_material_series_memberships")
      .values(
        metadata.seriesMemberships.map(({ ordinal, seriesId }) => ({
          material_id: values.revision.materialId,
          ordinal,
          series_id: seriesId,
        })),
      )
      .execute();
  }

  await transaction
    .insertInto("materials.material_search_documents")
    .values({
      material_id: values.revision.materialId,
      revision_id: values.revision.id,
      plain_text: values.extraction.plainText,
    })
    .onConflict((conflict) =>
      conflict.column("material_id").doUpdateSet({
        revision_id: values.revision.id,
        plain_text: values.extraction.plainText,
      }),
    )
    .execute();

  return {
    id: event.id,
    materialId: materialId(event.material_id),
    revisionId: materialRevisionId(event.revision_id),
    createdAt: event.created_at,
  };
}

export async function unpublishMaterialProjection(
  transaction: AuthoringTransaction,
  values: {
    readonly actor: string;
    readonly eventId: string;
    readonly materialId: MaterialId;
    readonly revisionId: MaterialRevisionId;
  },
): Promise<PublicationEvent> {
  const event = await transaction
    .insertInto("materials.material_publication_events")
    .values({
      id: values.eventId,
      material_id: values.materialId,
      revision_id: values.revisionId,
      kind: "unpublish",
      actor_id: values.actor,
    })
    .returning(["id", "material_id", "revision_id", "created_at"])
    .executeTakeFirstOrThrow();
  await transaction
    .updateTable("materials.materials")
    .set({ current_published_revision_id: null })
    .where("id", "=", values.materialId)
    .executeTakeFirstOrThrow();
  await transaction
    .deleteFrom("materials.published_materials")
    .where("material_id", "=", values.materialId)
    .executeTakeFirstOrThrow();
  return {
    id: event.id,
    materialId: materialId(event.material_id),
    revisionId: materialRevisionId(event.revision_id),
    createdAt: event.created_at,
  };
}

export async function loadPublicMaterialProjection(
  database: AuthoringDatabase,
  slug: string,
): Promise<PublicMaterialProjectionDto | undefined> {
  const row = await database
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
    ])
    .where("publication.slug", "=", slug)
    .executeTakeFirst();
  if (
    row === undefined ||
    (row.access !== "free" && row.access !== "membership")
  ) {
    return undefined;
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
