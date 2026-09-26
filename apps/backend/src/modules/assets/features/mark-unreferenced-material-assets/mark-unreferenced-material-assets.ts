import { z } from "zod";

import type { AssetsPrisma } from "../../../../infrastructure/prisma/index.js";

const uuidSchema = z.uuid();

type MaterialAssetReferencePrisma = Pick<AssetsPrisma, "materialAsset">;

/**
 * Records which ready Assets the saved Material body still references. It runs in the caller's
 * transaction under the Material reference lock, so a Save that rolls back leaves the marks as they
 * were and orphan cleanup never sees a reference change that did not commit.
 */
export async function markUnreferencedMaterialAssets(
  prisma: MaterialAssetReferencePrisma,
  input: {
    readonly materialId: string;
    readonly orphanedAt: Date;
    readonly referencedAssetIds: readonly string[];
  },
): Promise<void> {
  const referencedAssetIds = [...new Set(input.referencedAssetIds)];
  if (
    !uuidSchema.safeParse(input.materialId).success ||
    referencedAssetIds.some(
      (assetId) => !uuidSchema.safeParse(assetId).success,
    ) ||
    Number.isNaN(input.orphanedAt.getTime())
  ) {
    throw new TypeError("Invalid MaterialAsset reference boundary");
  }
  await prisma.materialAsset.updateMany({
    data: {
      currentlyReferenced: false,
      orphanedAt: input.orphanedAt,
      updatedAt: input.orphanedAt,
    },
    where: {
      currentlyReferenced: true,
      materialId: input.materialId,
      state: "ready",
      ...(referencedAssetIds.length === 0
        ? {}
        : { id: { notIn: referencedAssetIds } }),
    },
  });
  if (referencedAssetIds.length > 0) {
    await prisma.materialAsset.updateMany({
      data: { currentlyReferenced: true },
      where: {
        currentlyReferenced: false,
        id: { in: referencedAssetIds },
        materialId: input.materialId,
        state: "ready",
      },
    });
  }
}
