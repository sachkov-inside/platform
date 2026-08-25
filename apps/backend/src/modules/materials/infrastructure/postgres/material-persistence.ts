import { sql } from "kysely";

import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import {
  MaterialRevisionMetadata,
  type MaterialRevisionMetadataValues,
} from "../../domain/material-revision-metadata.js";
import { Material, materialRevision } from "../../domain/material.js";
import type { MaterialRevision } from "../../domain/material.js";
import {
  materialId,
  materialRevisionId,
  type MaterialId,
  type MaterialRevisionId,
} from "../../domain/material-identifiers.js";
import type { AuthoringDatabase, AuthoringTransaction } from "./database.js";

export interface PersistedMaterialRevision {
  readonly materialId: MaterialId;
  readonly revisionId: MaterialRevisionId;
  readonly restoredFromRevisionId: MaterialRevisionId | null;
  readonly metadata: MaterialRevisionMetadataValues;
  readonly schemaVersion: number;
  readonly body: unknown;
}

export interface MaterialRevisionHeader {
  readonly materialId: MaterialId;
  readonly revisionId: MaterialRevisionId;
  readonly access: "free" | "membership";
}

export async function insertMaterial(
  transaction: AuthoringTransaction,
  values: {
    readonly materialId: MaterialId;
    readonly revisionId: MaterialRevisionId;
    readonly slug: string;
  },
): Promise<void> {
  await transaction
    .insertInto("materials.materials")
    .values({
      id: values.materialId,
      slug: values.slug,
      current_draft_revision_id: values.revisionId,
    })
    .executeTakeFirstOrThrow();
}

export async function advanceCurrentRevision(
  transaction: AuthoringTransaction,
  values: {
    readonly materialId: MaterialId;
    readonly baseRevisionId: MaterialRevisionId;
    readonly revisionId: MaterialRevisionId;
    readonly slug: string;
  },
): Promise<boolean> {
  const updated = await transaction
    .updateTable("materials.materials")
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

export async function loadCurrentRevisionIdForValidation(
  transaction: AuthoringTransaction,
  materialIdValue: MaterialId,
): Promise<MaterialRevisionId | undefined> {
  const material = await transaction
    .selectFrom("materials.materials")
    .select("current_draft_revision_id")
    .where("id", "=", materialIdValue)
    .forShare()
    .executeTakeFirst();
  return material === undefined
    ? undefined
    : materialRevisionId(material.current_draft_revision_id);
}

export type MaterialRevisionHydration =
  | { readonly ok: true; readonly value: MaterialRevision }
  | { readonly ok: false };

export async function lockMaterialForLifecycleChange(
  transaction: AuthoringTransaction,
  materialIdValue: MaterialId,
): Promise<Material | undefined> {
  const row = await transaction
    .selectFrom("materials.materials")
    .select(["id", "current_draft_revision_id", "current_published_revision_id"])
    .where("id", "=", materialIdValue)
    .forUpdate()
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : Material.restore({
        id: materialId(row.id),
        currentDraftRevisionId: materialRevisionId(row.current_draft_revision_id),
        currentPublishedRevisionId:
          row.current_published_revision_id === null
            ? null
            : materialRevisionId(row.current_published_revision_id),
      });
}

export async function loadCurrentRevisionId(
  database: AuthoringDatabase,
  materialIdValue: MaterialId,
): Promise<MaterialRevisionId | undefined> {
  const material = await database
    .selectFrom("materials.materials")
    .select("current_draft_revision_id")
    .where("id", "=", materialIdValue)
    .executeTakeFirst();
  return material === undefined
    ? undefined
    : materialRevisionId(material.current_draft_revision_id);
}

export async function loadMaterialRevisionHeader(
  database: AuthoringDatabase,
  materialIdValue: MaterialId,
  revisionId: MaterialRevisionId,
): Promise<MaterialRevisionHeader | undefined> {
  const row = await database
    .selectFrom("materials.material_revisions")
    .select(["material_id", "id", "access"])
    .where("material_id", "=", materialIdValue)
    .where("id", "=", revisionId)
    .executeTakeFirst();
  return row === undefined || (row.access !== "free" && row.access !== "membership")
    ? undefined
    : {
        materialId: materialId(row.material_id),
        revisionId: materialRevisionId(row.id),
        access: row.access,
      };
}

type RevisionSelection =
  | { readonly kind: "current_draft" }
  | { readonly kind: "revision"; readonly revisionId: MaterialRevisionId }
  | {
      readonly kind: "current_publication";
      readonly revisionId: MaterialRevisionId;
    };

async function loadPersistedMaterialRevision(
  database: AuthoringDatabase,
  materialIdValue: MaterialId,
  selection: RevisionSelection,
): Promise<PersistedMaterialRevision | undefined> {
  let query = database
    .selectFrom("materials.materials as material")
    .innerJoin(
      "materials.material_revisions as revision",
      "revision.material_id",
      "material.id",
    )
    .select([
      "material.id as material_id",
      "revision.id as revision_id",
      "revision.title",
      "revision.summary",
      "revision.slug",
      "revision.access",
      "revision.topic_id",
      "revision.format_id",
      "revision.schema_version",
      "revision.restored_from_revision_id",
      "revision.body",
      sql<readonly string[]>`coalesce(
        (
          select jsonb_agg(revision_tag.tag_id order by revision_tag.tag_id)
          from materials.material_revision_tags as revision_tag
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
          from materials.material_revision_series_memberships as revision_series
          where revision_series.material_id = material.id
            and revision_series.revision_id = revision.id
        ),
        '[]'::jsonb
      )`.as("series_memberships"),
    ])
    .where("material.id", "=", materialIdValue);

  if (selection.kind === "current_draft") {
    query = query.whereRef("revision.id", "=", "material.current_draft_revision_id");
  } else {
    query = query.where("revision.id", "=", selection.revisionId);
    if (selection.kind === "current_publication") {
      query = query.whereRef(
        "revision.id",
        "=",
        "material.current_published_revision_id",
      );
    }
  }
  const row = await query.executeTakeFirst();
  if (row === undefined) {
    return undefined;
  }

  return {
    materialId: materialId(row.material_id),
    revisionId: materialRevisionId(row.revision_id),
    restoredFromRevisionId:
      row.restored_from_revision_id === null
        ? null
        : materialRevisionId(row.restored_from_revision_id),
    metadata: {
      title: row.title,
      summary: row.summary,
      slug: row.slug,
      access:
        row.access === "free" || row.access === "membership"
          ? row.access
          : "membership",
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
  materialBodyOperations: MaterialBodyOperations,
  persisted: PersistedMaterialRevision,
): MaterialRevisionHydration {
  const metadata = MaterialRevisionMetadata.create(persisted.metadata);
  const body = materialBodyOperations.accept({
    schemaVersion: persisted.schemaVersion,
    doc: persisted.body,
  });
  if (!metadata.ok || !body.ok) {
    return { ok: false };
  }
  return {
    ok: true,
    value: materialRevision({
      id: persisted.revisionId,
      materialId: persisted.materialId,
      ...(persisted.restoredFromRevisionId === null
        ? {}
        : { restoredFromRevisionId: persisted.restoredFromRevisionId }),
      metadata: metadata.value,
      body: body.value,
    }),
  };
}

export async function loadMaterialRevision(
  database: AuthoringDatabase,
  materialBodyOperations: MaterialBodyOperations,
  materialId: MaterialId,
  revisionId: MaterialRevisionId,
): Promise<MaterialRevisionHydration | undefined> {
  const persisted = await loadPersistedMaterialRevision(
    database,
    materialId,
    { kind: "revision", revisionId },
  );
  return persisted === undefined
    ? undefined
    : hydratePersistedMaterialRevision(materialBodyOperations, persisted);
}

export async function loadCurrentPublishedMaterialRevision(
  database: AuthoringDatabase,
  materialBodyOperations: MaterialBodyOperations,
  materialId: MaterialId,
  revisionId: MaterialRevisionId,
): Promise<MaterialRevisionHydration | undefined> {
  const persisted = await loadPersistedMaterialRevision(
    database,
    materialId,
    { kind: "current_publication", revisionId },
  );
  return persisted === undefined
    ? undefined
    : hydratePersistedMaterialRevision(materialBodyOperations, persisted);
}

export async function loadCurrentDraftRevision(
  database: AuthoringDatabase,
  materialBodyOperations: MaterialBodyOperations,
  materialId: MaterialId,
): Promise<MaterialRevisionHydration | undefined> {
  const persisted = await loadPersistedMaterialRevision(database, materialId, {
    kind: "current_draft",
  });
  if (persisted === undefined) {
    return undefined;
  }
  const revision = hydratePersistedMaterialRevision(
    materialBodyOperations,
    persisted,
  );
  return revision;
}
