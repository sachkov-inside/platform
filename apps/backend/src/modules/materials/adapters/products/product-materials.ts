import type { ProductMaterials } from "../../../products/index.js";
import {
  lockMaterialReferenceChanges,
  type MaterialsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { materialsTransaction } from "../../infrastructure/transaction.js";
import { refreshPublishedMaterialSearchProjections } from "../../infrastructure/postgres/published-material-search.js";
import { z } from "zod";

const publicationState = z.enum(["draft", "published", "unpublished"]);
const access = z.enum(["free", "closed"]);
export function assembleProductMaterials(
  prisma: MaterialsPrismaClient,
): ProductMaterials {
  return {
    async load(ids: readonly string[], handle?: TransactionHandle) {
      const tx = handle === undefined ? prisma : materialsTransaction(handle);
      const [materials, publications] = await Promise.all([
        tx.material.findMany({
          where: { id: { in: [...ids] } },
          select: {
            id: true,
            sourceId: true,
            publicationState: true,
            title: true,
            access: true,
            showInFeed: true,
            topicId: true,
          },
        }),
        tx.publishedMaterial.findMany({
          where: { materialId: { in: [...ids] } },
          select: { materialId: true, hasModeVariants: true },
        }),
      ]);
      const modes = new Map(
        publications.map((publication) => [
          publication.materialId,
          publication.hasModeVariants,
        ]),
      );
      return materials.map((material) => ({
        ...material,
        publicationState: publicationState.parse(material.publicationState),
        access: access.parse(material.access),
        hasModeVariants: modes.get(material.id) ?? false,
      }));
    },
    lockReferences: (ids, handle) =>
      lockMaterialReferenceChanges(materialsTransaction(handle), ids),
    refreshSearch: (ids, handle) =>
      refreshPublishedMaterialSearchProjections(materialsTransaction(handle), {
        kind: "materials",
        materialIds: ids,
      }),
  };
}
