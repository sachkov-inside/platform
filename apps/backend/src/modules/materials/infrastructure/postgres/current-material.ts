import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { ProductMemberships } from "../../../products/index.js";
import {
  recordedAuthoringSourceSchema,
  type RecordedAuthoringSource,
} from "../../domain/authoring-source.js";
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
import type { VideoAuthoringPresentation } from "../../../videos/index.js";
import { type ContentCoverProjection } from "../../../content-covers/index.js";
import { loadContentCoverProjections } from "../../../content-covers/index.js";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);

export interface CurrentMaterial {
  readonly notifyTelegram: boolean | null;
  readonly source: RecordedAuthoringSource | null;
  readonly lifecycle: Material;
  readonly metadata: MaterialMetadata;
  readonly body: MaterialBody;
  readonly primaryVideoId: string | null;
  readonly cover: ContentCoverProjection | null;
}

export async function loadCurrentMaterial(
  prisma: MaterialsPrisma,
  bodyOperations: MaterialBodyOperations,
  materialId: MaterialId,
  products: ProductMemberships,
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
  const [tags, productMemberships, covers] = await Promise.all([
    prisma.materialTag.findMany({
      where: { materialId },
      select: { tagId: true },
      orderBy: { tagId: "asc" },
    }),
    products.load(materialId, transactionHandle(prisma)),
    loadContentCoverProjections(
      transactionHandle(prisma),
      row.coverId === null ? [] : [row.coverId],
    ),
  ]);
  const metadata = MaterialMetadata.create({
    title: row.title,
    summary: row.summary,
    slug: row.slug,
    access: row.access,
    difficulty: row.difficulty,
    outcomes: row.outcomes,
    topicId: row.topicId,
    formatId: row.formatId,
    tagIds: tags.map(({ tagId }) => tagId),
    productMemberships,
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
      notifyTelegram: row.notifyTelegram,
      source:
        row.sourceId === null
          ? null
          : recordedAuthoringSourceSchema.parse({
              id: row.sourceId,
              path: row.sourcePath,
              revision: row.sourceRevision,
              version: 2 as const,
              commit: row.sourceCommit,
            }),
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
      cover: row.coverId === null ? null : (covers.get(row.coverId) ?? null),
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

export function toMaterialDto(
  material: CurrentMaterial,
  videos: {
    readonly latestVideoDeletion: VideoAuthoringPresentation | null;
    readonly primaryVideo: VideoAuthoringPresentation | null;
    readonly unselectedVideoUpload: VideoAuthoringPresentation | null;
  },
): MaterialDto {
  return {
    notifyTelegram: material.notifyTelegram,
    ...(material.source === null
      ? {}
      : {
          source: {
            id: material.source.id,
            path: material.source.path,
            revision: material.source.revision,
            version: 2 as const,
            // Absent rather than null: clients that predate the commit read `source` strictly,
            // and only a newer client records a commit.
            ...(material.source.commit === null
              ? {}
              : { commit: material.source.commit }),
          },
        }),
    materialId: material.lifecycle.id,
    contentVersion: material.lifecycle.contentVersion,
    publicationState: material.lifecycle.publicationState,
    firstPublishedAt:
      material.lifecycle.firstPublishedAt?.toISOString() ?? null,
    publishedAt: material.lifecycle.publishedAt?.toISOString() ?? null,
    primaryVideoId: material.primaryVideoId,
    primaryVideo: videos.primaryVideo,
    latestVideoDeletion: videos.latestVideoDeletion,
    unselectedVideoUpload: videos.unselectedVideoUpload,
    cover: material.cover,
    metadata: material.metadata.toValues(),
    body: material.body,
  };
}

export async function replaceCurrentRelations(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  metadata: MaterialMetadata,
  products: ProductMemberships,
): Promise<void> {
  await transaction.materialTag.deleteMany({ where: { materialId } });
  if (metadata.tagIds.length > 0) {
    await transaction.materialTag.createMany({
      data: metadata.tagIds.map((tagId) => ({ materialId, tagId })),
    });
  }
  await products.replace(
    materialId,
    metadata.productMemberships,
    transactionHandle(transaction),
  );
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
