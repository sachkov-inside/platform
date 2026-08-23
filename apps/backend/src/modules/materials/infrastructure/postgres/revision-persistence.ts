import type { Json, JsonObject } from "../../../../infrastructure/postgres/generated/database.js";
import type { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";
import type { AuthoringTransaction } from "./database.js";

function toDatabaseJson(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toDatabaseJson);
  }
  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        result[key] = toDatabaseJson(child);
      }
    }
    return result;
  }
  throw new TypeError("Document contains a non-JSON value");
}

export async function insertRevision(
  transaction: AuthoringTransaction,
  values: {
    readonly actor: string;
    readonly materialId: string;
    readonly restoredFromRevisionId?: string;
    readonly revisionId: string;
    readonly metadata: MaterialRevisionMetadata;
    readonly schemaVersion: number;
    readonly body: unknown;
  },
): Promise<void> {
  await transaction
    .insertInto("material_revisions")
    .values({
      id: values.revisionId,
      material_id: values.materialId,
      restored_from_revision_id: values.restoredFromRevisionId ?? null,
      title: values.metadata.title,
      summary: values.metadata.summary,
      slug: values.metadata.slug,
      access: values.metadata.access,
      topic_id: values.metadata.topicId,
      format_id: values.metadata.formatId,
      schema_version: values.schemaVersion,
      body: toDatabaseJson(values.body),
      created_by: values.actor,
    })
    .executeTakeFirstOrThrow();

  if (values.metadata.tagIds.length > 0) {
    await transaction
      .insertInto("material_revision_tags")
      .values(
        values.metadata.tagIds.map((tagId) => ({
          material_id: values.materialId,
          revision_id: values.revisionId,
          tag_id: tagId,
        })),
      )
      .execute();
  }
  if (values.metadata.seriesMemberships.length > 0) {
    await transaction
      .insertInto("material_revision_series_memberships")
      .values(
        values.metadata.seriesMemberships.map(({ seriesId, ordinal }) => ({
          material_id: values.materialId,
          revision_id: values.revisionId,
          series_id: seriesId,
          ordinal,
        })),
      )
      .execute();
  }
}

export async function replaceCurrentRelations(
  transaction: AuthoringTransaction,
  materialId: string,
  metadata: MaterialRevisionMetadata,
): Promise<void> {
  await transaction.deleteFrom("material_tags").where("material_id", "=", materialId).execute();
  await transaction
    .deleteFrom("series_memberships")
    .where("material_id", "=", materialId)
    .execute();

  if (metadata.tagIds.length > 0) {
    await transaction
      .insertInto("material_tags")
      .values(metadata.tagIds.map((tagId) => ({ material_id: materialId, tag_id: tagId })))
      .execute();
  }
  if (metadata.seriesMemberships.length > 0) {
    await transaction
      .insertInto("series_memberships")
      .values(
        metadata.seriesMemberships.map(({ seriesId, ordinal }) => ({
          material_id: materialId,
          series_id: seriesId,
          ordinal,
        })),
      )
      .execute();
  }
}
