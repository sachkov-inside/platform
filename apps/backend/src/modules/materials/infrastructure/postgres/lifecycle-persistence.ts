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
    .selectFrom("material_publication_events")
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
    .insertInto("material_publication_events")
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
    .updateTable("materials")
    .set({ current_published_revision_id: values.revision.id })
    .where("id", "=", values.revision.materialId)
    .executeTakeFirstOrThrow();

  await transaction
    .insertInto("published_materials")
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
    .deleteFrom("published_material_tags")
    .where("material_id", "=", values.revision.materialId)
    .execute();
  if (metadata.tagIds.length > 0) {
    await transaction
      .insertInto("published_material_tags")
      .values(
        metadata.tagIds.map((tagId) => ({
          material_id: values.revision.materialId,
          tag_id: tagId,
        })),
      )
      .execute();
  }

  await transaction
    .deleteFrom("published_material_series_memberships")
    .where("material_id", "=", values.revision.materialId)
    .execute();
  if (metadata.seriesMemberships.length > 0) {
    await transaction
      .insertInto("published_material_series_memberships")
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
    .insertInto("material_search_documents")
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
    .insertInto("material_publication_events")
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
    .updateTable("materials")
    .set({ current_published_revision_id: null })
    .where("id", "=", values.materialId)
    .executeTakeFirstOrThrow();
  await transaction
    .deleteFrom("published_materials")
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
    .selectFrom("published_materials as publication")
    .select([
      "publication.material_id",
      "publication.revision_id",
      "publication.slug",
      "publication.title",
      "publication.summary",
      "publication.access",
      "publication.topic_id",
      "publication.format_id",
      sql<readonly string[]>`coalesce(
        (
          select jsonb_agg(tag.tag_id order by tag.tag_id)
          from published_material_tags as tag
          where tag.material_id = publication.material_id
        ),
        '[]'::jsonb
      )`.as("tag_ids"),
      sql<readonly { readonly series_id: string; readonly ordinal: number }[]>`coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('series_id', membership.series_id, 'ordinal', membership.ordinal)
            order by membership.series_id
          )
          from published_material_series_memberships as membership
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
    topicId: row.topic_id,
    formatId: row.format_id,
    tagIds: row.tag_ids,
    seriesMemberships: row.series_memberships.map(({ ordinal, series_id }) => ({
      ordinal,
      seriesId: series_id,
    })),
  };
}
