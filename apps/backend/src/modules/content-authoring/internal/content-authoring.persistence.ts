import { sql, type Kysely, type Transaction } from "kysely";

import type { DB, Json, JsonObject } from "../../../infrastructure/postgres/generated/database.js";
import type {
  DraftMetadata,
  DraftSnapshot,
} from "../content-authoring.interface.js";

export type AuthoringTransaction = Transaction<DB>;
type DatabaseExecutor = Kysely<DB>;

export interface PersistedDraftInput {
  readonly materialId: string;
  readonly revisionId: string;
  readonly metadata: DraftMetadata;
  readonly schemaVersion: number;
  readonly body: unknown;
}

export type IdempotencyClaim =
  | { readonly kind: "claimed" }
  | { readonly kind: "replay"; readonly materialId: string; readonly revisionId: string }
  | { readonly kind: "reused" }
  | { readonly kind: "incomplete" };

export async function claimIdempotency(
  transaction: AuthoringTransaction,
  values: {
    readonly actor: string;
    readonly operation: "create_draft" | "revise_draft";
    readonly key: string;
    readonly fingerprint: string;
  },
): Promise<IdempotencyClaim> {
  const inserted = await transaction
    .insertInto("authoring_idempotency")
    .values({
      actor_id: values.actor,
      operation: values.operation,
      idempotency_key: values.key,
      request_fingerprint: values.fingerprint,
      material_id: null,
      revision_id: null,
    })
    .onConflict((conflict) =>
      conflict.columns(["actor_id", "operation", "idempotency_key"]).doNothing(),
    )
    .returning("request_fingerprint")
    .executeTakeFirst();

  if (inserted !== undefined) {
    return { kind: "claimed" };
  }

  const existing = await transaction
    .selectFrom("authoring_idempotency")
    .select(["request_fingerprint", "material_id", "revision_id"])
    .where("actor_id", "=", values.actor)
    .where("operation", "=", values.operation)
    .where("idempotency_key", "=", values.key)
    .executeTakeFirstOrThrow();

  if (existing.request_fingerprint.trim() !== values.fingerprint) {
    return { kind: "reused" };
  }
  if (existing.material_id === null || existing.revision_id === null) {
    return { kind: "incomplete" };
  }
  return {
    kind: "replay",
    materialId: existing.material_id,
    revisionId: existing.revision_id,
  };
}

export async function completeIdempotency(
  transaction: AuthoringTransaction,
  values: {
    readonly actor: string;
    readonly operation: "create_draft" | "revise_draft";
    readonly key: string;
    readonly materialId: string;
    readonly revisionId: string;
  },
): Promise<void> {
  await transaction
    .updateTable("authoring_idempotency")
    .set({ material_id: values.materialId, revision_id: values.revisionId })
    .where("actor_id", "=", values.actor)
    .where("operation", "=", values.operation)
    .where("idempotency_key", "=", values.key)
    .executeTakeFirstOrThrow();
}

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

export async function insertMaterial(
  transaction: AuthoringTransaction,
  values: { readonly materialId: string; readonly revisionId: string; readonly slug: string },
): Promise<void> {
  await transaction
    .insertInto("materials")
    .values({
      id: values.materialId,
      slug: values.slug,
      current_draft_revision_id: values.revisionId,
    })
    .executeTakeFirstOrThrow();
}

export async function insertRevision(
  transaction: AuthoringTransaction,
  values: {
    readonly actor: string;
    readonly materialId: string;
    readonly revisionId: string;
    readonly metadata: DraftMetadata;
    readonly schemaVersion: number;
    readonly body: unknown;
  },
): Promise<void> {
  await transaction
    .insertInto("material_revisions")
    .values({
      id: values.revisionId,
      material_id: values.materialId,
      title: values.metadata.title,
      summary: values.metadata.summary,
      slug: values.metadata.slug,
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
  metadata: DraftMetadata,
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

export async function advanceCurrentRevision(
  transaction: AuthoringTransaction,
  values: {
    readonly materialId: string;
    readonly baseRevisionId: string;
    readonly revisionId: string;
    readonly slug: string;
  },
): Promise<boolean> {
  const updated = await transaction
    .updateTable("materials")
    .set({
      current_draft_revision_id: values.revisionId,
      slug: values.slug,
      updated_at: new Date(),
    })
    .where("id", "=", values.materialId)
    .where("current_draft_revision_id", "=", values.baseRevisionId)
    .returning("id")
    .executeTakeFirst();
  return updated !== undefined;
}

export async function loadCurrentRevisionId(
  executor: DatabaseExecutor,
  materialId: string,
): Promise<string | undefined> {
  const material = await executor
    .selectFrom("materials")
    .select("current_draft_revision_id")
    .where("id", "=", materialId)
    .executeTakeFirst();
  return material?.current_draft_revision_id;
}

export async function loadPersistedDraft(
  executor: DatabaseExecutor,
  materialId: string,
  revisionId?: string,
): Promise<PersistedDraftInput | undefined> {
  let query = executor
    .selectFrom("materials as material")
    .innerJoin("material_revisions as revision", "revision.material_id", "material.id")
    .select([
      "material.id as material_id",
      "revision.id as revision_id",
      "revision.title",
      "revision.summary",
      "revision.slug",
      "revision.topic_id",
      "revision.format_id",
      "revision.schema_version",
      "revision.body",
      sql<readonly string[]>`coalesce(
        (
          select jsonb_agg(revision_tag.tag_id order by revision_tag.tag_id)
          from material_revision_tags as revision_tag
          where revision_tag.material_id = material.id
            and revision_tag.revision_id = revision.id
        ),
        '[]'::jsonb
      )`.as("tag_ids"),
      sql<readonly { readonly series_id: string; readonly ordinal: number }[]>`coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'series_id', revision_series.series_id,
              'ordinal', revision_series.ordinal
            )
            order by revision_series.series_id
          )
          from material_revision_series_memberships as revision_series
          where revision_series.material_id = material.id
            and revision_series.revision_id = revision.id
        ),
        '[]'::jsonb
      )`.as("series_memberships"),
    ])
    .where("material.id", "=", materialId);

  query =
    revisionId === undefined
      ? query.whereRef("revision.id", "=", "material.current_draft_revision_id")
      : query.where("revision.id", "=", revisionId);
  const row = await query.executeTakeFirst();
  if (row === undefined) {
    return undefined;
  }

  return {
    materialId: row.material_id,
    revisionId: row.revision_id,
    metadata: {
      title: row.title,
      summary: row.summary,
      slug: row.slug,
      topicId: row.topic_id,
      formatId: row.format_id,
      tagIds: row.tag_ids,
      seriesMemberships: row.series_memberships.map(({ series_id, ordinal }) => ({
        seriesId: series_id,
        ordinal,
      })),
    },
    schemaVersion: row.schema_version,
    body: row.body,
  };
}

export async function findReferenceIssues(
  executor: DatabaseExecutor,
  metadata: DraftMetadata,
): Promise<readonly { readonly code: string; readonly path: string }[]> {
  const issues: { code: string; path: string }[] = [];
  const topic = await executor
    .selectFrom("topics")
    .select("id")
    .where("id", "=", metadata.topicId)
    .executeTakeFirst();
  if (topic === undefined) {
    issues.push({ code: "topic_not_found", path: "/metadata/topicId" });
  }
  const format = await executor
    .selectFrom("formats")
    .select("id")
    .where("id", "=", metadata.formatId)
    .executeTakeFirst();
  if (format === undefined) {
    issues.push({ code: "format_not_found", path: "/metadata/formatId" });
  }
  if (metadata.tagIds.length > 0) {
    const tags = await executor
      .selectFrom("tags")
      .select("id")
      .where("id", "in", metadata.tagIds)
      .execute();
    const found = new Set(tags.map(({ id }) => id));
    metadata.tagIds.forEach((tagId, index) => {
      if (!found.has(tagId)) {
        issues.push({ code: "tag_not_found", path: `/metadata/tagIds/${index}` });
      }
    });
  }
  if (metadata.seriesMemberships.length > 0) {
    const seriesIds = metadata.seriesMemberships.map(({ seriesId }) => seriesId);
    const series = await executor
      .selectFrom("series")
      .select("id")
      .where("id", "in", seriesIds)
      .execute();
    const found = new Set(series.map(({ id }) => id));
    metadata.seriesMemberships.forEach(({ seriesId }, index) => {
      if (!found.has(seriesId)) {
        issues.push({
          code: "series_not_found",
          path: `/metadata/seriesMemberships/${index}/seriesId`,
        });
      }
    });
  }
  return issues.sort((left, right) => left.path.localeCompare(right.path));
}

export async function findSeriesOrdinalConflict(
  transaction: AuthoringTransaction,
  materialId: string,
  metadata: DraftMetadata,
): Promise<{ readonly seriesId: string; readonly ordinal: number } | undefined> {
  if (metadata.seriesMemberships.length === 0) {
    return undefined;
  }
  const seriesIds = metadata.seriesMemberships.map(({ seriesId }) => seriesId);
  await transaction
    .selectFrom("series")
    .select("id")
    .where("id", "in", seriesIds)
    .orderBy("id")
    .forUpdate()
    .execute();

  const occupied = await transaction
    .selectFrom("series_memberships")
    .select(["series_id", "ordinal"])
    .where("series_id", "in", seriesIds)
    .where(
      "ordinal",
      "in",
      metadata.seriesMemberships.map(({ ordinal }) => ordinal),
    )
    .where("material_id", "!=", materialId)
    .execute();
  const occupiedKeys = new Set(
    occupied.map(({ series_id, ordinal }) => `${series_id}:${ordinal}`),
  );
  return metadata.seriesMemberships.find(({ seriesId, ordinal }) =>
    occupiedKeys.has(`${seriesId}:${ordinal}`),
  );
}

export function toDraftSnapshot(
  persisted: PersistedDraftInput,
  body: DraftSnapshot["body"],
): DraftSnapshot {
  return {
    materialId: persisted.materialId,
    revisionId: persisted.revisionId,
    metadata: persisted.metadata,
    body,
  };
}
