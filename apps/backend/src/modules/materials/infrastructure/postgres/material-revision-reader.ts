import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import {
  MaterialRevisionMetadata,
  type MaterialRevisionMetadataValues,
} from "../../domain/material-revision-metadata.js";
import { materialRevision } from "../../domain/material.js";
import type { MaterialRevision } from "../../domain/material.js";
import {
  materialId,
  materialRevisionId,
  type MaterialId,
  type MaterialRevisionId,
} from "../../domain/material-identifiers.js";

interface PersistedMaterialRevision {
  readonly materialId: MaterialId;
  readonly revisionId: MaterialRevisionId;
  readonly restoredFromRevisionId: MaterialRevisionId | null;
  readonly metadata: MaterialRevisionMetadataValues;
  readonly schemaVersion: number;
  readonly body: unknown;
}

export type MaterialRevisionHydration =
  | { readonly ok: true; readonly value: MaterialRevision }
  | { readonly ok: false };

type RevisionSelection =
  | { readonly kind: "current_draft" }
  | { readonly kind: "revision"; readonly revisionId: MaterialRevisionId }
  | {
      readonly kind: "current_publication";
      readonly revisionId: MaterialRevisionId;
    };

async function loadPersistedMaterialRevision(
  prisma: MaterialsPrisma,
  materialIdValue: MaterialId,
  selection: RevisionSelection,
): Promise<PersistedMaterialRevision | undefined> {
  const selectedRevisionId = await resolveRevisionId(
    prisma,
    materialIdValue,
    selection,
  );
  if (selectedRevisionId === undefined) {
    return undefined;
  }

  const row = await prisma.materialRevision.findFirst({
    where: { materialId: materialIdValue, id: selectedRevisionId },
    select: {
      id: true,
      materialId: true,
      restoredFromRevisionId: true,
      title: true,
      summary: true,
      slug: true,
      access: true,
      topicId: true,
      formatId: true,
      schemaVersion: true,
      body: true,
    },
  });
  if (row === null) {
    return undefined;
  }

  const tags = await prisma.materialRevisionTag.findMany({
    where: { materialId: materialIdValue, revisionId: selectedRevisionId },
    select: { tagId: true },
    orderBy: { tagId: "asc" },
  });
  const seriesMemberships =
    await prisma.materialRevisionSeriesMembership.findMany({
      where: { materialId: materialIdValue, revisionId: selectedRevisionId },
      select: { seriesId: true, ordinal: true },
      orderBy: { seriesId: "asc" },
    });

  return {
    materialId: materialId(row.materialId),
    revisionId: materialRevisionId(row.id),
    restoredFromRevisionId:
      row.restoredFromRevisionId === null
        ? null
        : materialRevisionId(row.restoredFromRevisionId),
    metadata: {
      title: row.title,
      summary: row.summary,
      slug: row.slug,
      access:
        row.access === "free" || row.access === "membership"
          ? row.access
          : "membership",
      topicId: row.topicId,
      formatId: row.formatId,
      tagIds: tags.map(({ tagId }) => tagId),
      seriesMemberships: seriesMemberships.map(({ seriesId, ordinal }) => ({
        seriesId,
        ordinal,
      })),
    },
    schemaVersion: row.schemaVersion,
    body: row.body,
  };
}

async function resolveRevisionId(
  prisma: MaterialsPrisma,
  materialIdValue: MaterialId,
  selection: RevisionSelection,
): Promise<MaterialRevisionId | undefined> {
  if (selection.kind === "revision") {
    return selection.revisionId;
  }
  const material = await prisma.material.findUnique({
    where: { id: materialIdValue },
    select: {
      currentDraftRevisionId: true,
      currentPublishedRevisionId: true,
    },
  });
  if (material === null) {
    return undefined;
  }
  if (selection.kind === "current_draft") {
    return materialRevisionId(material.currentDraftRevisionId);
  }
  return material.currentPublishedRevisionId === selection.revisionId
    ? selection.revisionId
    : undefined;
}

function hydrateMaterialRevision(
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
  prisma: MaterialsPrisma,
  materialBodyOperations: MaterialBodyOperations,
  materialIdValue: MaterialId,
  revisionIdValue: MaterialRevisionId,
): Promise<MaterialRevisionHydration | undefined> {
  const persisted = await loadPersistedMaterialRevision(
    prisma,
    materialIdValue,
    { kind: "revision", revisionId: revisionIdValue },
  );
  return persisted === undefined
    ? undefined
    : hydrateMaterialRevision(materialBodyOperations, persisted);
}

export async function loadCurrentPublishedMaterialRevision(
  prisma: MaterialsPrisma,
  materialBodyOperations: MaterialBodyOperations,
  materialIdValue: MaterialId,
  revisionIdValue: MaterialRevisionId,
): Promise<MaterialRevisionHydration | undefined> {
  const persisted = await loadPersistedMaterialRevision(
    prisma,
    materialIdValue,
    { kind: "current_publication", revisionId: revisionIdValue },
  );
  return persisted === undefined
    ? undefined
    : hydrateMaterialRevision(materialBodyOperations, persisted);
}

export async function loadCurrentDraftRevision(
  prisma: MaterialsPrisma,
  materialBodyOperations: MaterialBodyOperations,
  materialIdValue: MaterialId,
): Promise<MaterialRevisionHydration | undefined> {
  const persisted = await loadPersistedMaterialRevision(
    prisma,
    materialIdValue,
    { kind: "current_draft" },
  );
  return persisted === undefined
    ? undefined
    : hydrateMaterialRevision(materialBodyOperations, persisted);
}
