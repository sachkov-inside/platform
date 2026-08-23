import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import type { ContentSchema } from "../../../content-schema/index.js";
import type {
  ApplicationResult,
  DraftMetadata,
  DraftSnapshot,
  DraftWriteValue,
} from "../../content-authoring.interface.js";
import { failure, rollback } from "./application-result.js";
import type { AuthoringDatabase } from "./database.js";

export interface PersistedDraftInput {
  readonly materialId: string;
  readonly revisionId: string;
  readonly metadata: DraftMetadata;
  readonly schemaVersion: number;
  readonly body: unknown;
}

export async function loadCurrentRevisionId(
  database: AuthoringDatabase,
  materialId: string,
): Promise<string | undefined> {
  const material = await database
    .selectFrom("materials")
    .select("current_draft_revision_id")
    .where("id", "=", materialId)
    .executeTakeFirst();
  return material?.current_draft_revision_id;
}

export async function loadPersistedDraft(
  database: AuthoringDatabase,
  materialId: string,
  revisionId?: string,
): Promise<PersistedDraftInput | undefined> {
  let query = database
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

export function hydratePersistedDraft(
  contentSchema: ContentSchema,
  persisted: PersistedDraftInput,
): ApplicationResult<DraftSnapshot> {
  const body = contentSchema.acceptDocument({
    schemaVersion: persisted.schemaVersion,
    doc: persisted.body,
  });
  if (!body.ok) {
    return failure({ code: "internal_error", correlationId: randomUUID() });
  }
  return {
    ok: true,
    value: {
      materialId: persisted.materialId,
      revisionId: persisted.revisionId,
      metadata: persisted.metadata,
      body: body.value,
    },
  };
}

export async function loadWriteValue(
  database: AuthoringDatabase,
  contentSchema: ContentSchema,
  materialId: string,
  revisionId: string,
): Promise<DraftWriteValue> {
  const persisted = await loadPersistedDraft(database, materialId, revisionId);
  if (persisted === undefined) {
    rollback({ code: "internal_error", correlationId: randomUUID() });
  }
  const draft = hydratePersistedDraft(contentSchema, persisted);
  if (!draft.ok) {
    rollback(draft.error);
  }
  return { materialId, revisionId, draft: draft.value };
}
