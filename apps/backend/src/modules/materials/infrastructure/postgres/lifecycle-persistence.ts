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
