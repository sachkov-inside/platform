import { sql } from "kysely";

import type { MaterialDocumentOperations } from "../../domain/material-document/material-document.js";
import {
  MaterialRevisionMetadata,
  type MaterialRevisionMetadataValues,
} from "../../domain/material-revision-metadata.js";
import {
  restoreMaterial,
  restoreMaterialRevision,
  type Material,
  type MaterialRevision,
} from "../../domain/material.js";
import type { AuthoringDatabase } from "./database.js";

export interface PersistedMaterialRevision {
  readonly materialId: string;
  readonly revisionId: string;
  readonly metadata: MaterialRevisionMetadataValues;
  readonly schemaVersion: number;
  readonly body: unknown;
}

export type MaterialRevisionHydration =
  | { readonly ok: true; readonly value: MaterialRevision }
  | { readonly ok: false };

export type MaterialHydration =
  | { readonly ok: true; readonly value: Material }
  | { readonly ok: false };

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

export async function loadPersistedMaterialRevision(
  database: AuthoringDatabase,
  materialId: string,
  revisionId?: string,
): Promise<PersistedMaterialRevision | undefined> {
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

export function hydratePersistedMaterialRevision(
  materialDocumentOperations: MaterialDocumentOperations,
  persisted: PersistedMaterialRevision,
): MaterialRevisionHydration {
  const metadata = MaterialRevisionMetadata.create(persisted.metadata);
  const body = materialDocumentOperations.accept({
    schemaVersion: persisted.schemaVersion,
    doc: persisted.body,
  });
  if (!metadata.ok || !body.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    value: restoreMaterialRevision({
      id: persisted.revisionId,
      materialId: persisted.materialId,
      metadata: metadata.value,
      body: body.value,
    }),
  };
}

export async function loadMaterialRevision(
  database: AuthoringDatabase,
  materialDocumentOperations: MaterialDocumentOperations,
  materialId: string,
  revisionId: string,
): Promise<MaterialRevisionHydration | undefined> {
  const persisted = await loadPersistedMaterialRevision(
    database,
    materialId,
    revisionId,
  );
  return persisted === undefined
    ? undefined
    : hydratePersistedMaterialRevision(materialDocumentOperations, persisted);
}

export async function loadCurrentMaterial(
  database: AuthoringDatabase,
  materialDocumentOperations: MaterialDocumentOperations,
  materialId: string,
): Promise<MaterialHydration | undefined> {
  const persisted = await loadPersistedMaterialRevision(database, materialId);
  if (persisted === undefined) {
    return undefined;
  }
  const revision = hydratePersistedMaterialRevision(
    materialDocumentOperations,
    persisted,
  );
  return revision.ok
    ? { ok: true, value: restoreMaterial(revision.value) }
    : revision;
}
