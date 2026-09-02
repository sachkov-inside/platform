import { z } from "zod";

import type {
  MaterialsPrisma,
  MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import type {
  MaterialBody,
  MaterialBodyOperations,
} from "../../domain/material-body/material-body.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import { MaterialMetadata } from "../../domain/material-metadata.js";
import { Material } from "../../domain/material.js";
import type {
  InvalidContentError,
  MaterialDto,
} from "../../facets/material-authoring/material-authoring.contract.js";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);

export interface CurrentMaterial {
  readonly lifecycle: Material;
  readonly metadata: MaterialMetadata;
  readonly body: MaterialBody;
  readonly primaryVideoId: string | null;
}

export async function loadCurrentMaterial(
  prisma: MaterialsPrisma,
  bodyOperations: MaterialBodyOperations,
  materialId: MaterialId,
): Promise<
  | { readonly ok: true; readonly value: CurrentMaterial }
  | { readonly ok: false; readonly error: InvalidContentError }
  | undefined
> {
  const row = await prisma.material.findUnique({
    where: { id: materialId },
  });
  if (row === null) {
    return undefined;
  }
  const [tags, seriesMemberships] = await Promise.all([
    prisma.materialTag.findMany({
      where: { materialId },
      select: { tagId: true },
      orderBy: { tagId: "asc" },
    }),
    prisma.seriesMembership.findMany({
      where: { materialId },
      select: { seriesId: true, ordinal: true },
      orderBy: { seriesId: "asc" },
    }),
  ]);
  const metadata = MaterialMetadata.create({
    title: row.title,
    summary: row.summary,
    slug: row.slug,
    access: row.access,
    topicId: row.topicId,
    formatId: row.formatId,
    tagIds: tags.map(({ tagId }) => tagId),
    seriesMemberships,
  });
  const body = bodyOperations.accept({
    schemaVersion: row.schemaVersion,
    doc: row.body,
  });
  const publicationState = publicationStateSchema.safeParse(
    row.publicationState,
  );
  const contentVersion = Number(row.contentVersion);
  if (
    !metadata.ok ||
    !body.ok ||
    !publicationState.success ||
    !Number.isSafeInteger(contentVersion)
  ) {
    return invalidPersistedMaterial();
  }
  return {
    ok: true,
    value: {
      lifecycle: Material.restore({
        id: materialId,
        slug: row.slug,
        publicationState: publicationState.data,
        contentVersion,
        firstPublishedAt: row.firstPublishedAt,
        publishedAt: row.publishedAt,
      }),
      metadata: metadata.value,
      body: body.value,
      primaryVideoId: row.primaryVideoId,
    },
  };
}

export async function loadPublishedBodyAtVersion(
  prisma: MaterialsPrisma,
  bodyOperations: MaterialBodyOperations,
  materialId: MaterialId,
  contentVersion: number,
): Promise<MaterialBody | undefined> {
  const row = await prisma.material.findFirst({
    where: {
      id: materialId,
      publicationState: "published",
      contentVersion: BigInt(contentVersion),
    },
    select: { schemaVersion: true, body: true },
  });
  if (row === null) {
    return undefined;
  }
  const body = bodyOperations.accept({
    schemaVersion: row.schemaVersion,
    doc: row.body,
  });
  return body.ok ? body.value : undefined;
}

export function toMaterialDto(material: CurrentMaterial): MaterialDto {
  return {
    materialId: material.lifecycle.id,
    contentVersion: material.lifecycle.contentVersion,
    publicationState: material.lifecycle.publicationState,
    firstPublishedAt:
      material.lifecycle.firstPublishedAt?.toISOString() ?? null,
    publishedAt: material.lifecycle.publishedAt?.toISOString() ?? null,
    primaryVideoId: material.primaryVideoId,
    metadata: material.metadata.toValues(),
    body: material.body,
  };
}

export async function replaceCurrentRelations(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  metadata: MaterialMetadata,
): Promise<void> {
  await transaction.materialTag.deleteMany({ where: { materialId } });
  if (metadata.tagIds.length > 0) {
    await transaction.materialTag.createMany({
      data: metadata.tagIds.map((tagId) => ({ materialId, tagId })),
    });
  }
  await transaction.seriesMembership.deleteMany({ where: { materialId } });
  if (metadata.seriesMemberships.length > 0) {
    await transaction.seriesMembership.createMany({
      data: metadata.seriesMemberships.map(({ seriesId, ordinal }) => ({
        materialId,
        seriesId,
        ordinal,
      })),
    });
  }
}

function invalidPersistedMaterial(): {
  readonly ok: false;
  readonly error: InvalidContentError;
} {
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: [{ code: "invalid_persisted_material", path: "" }],
    },
  };
}
