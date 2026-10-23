import type { MaterialsPrisma } from "../../../infrastructure/prisma/index.js";
import { ProductCompositions } from "../../products/index.js";
export {
  MAX_PRODUCT_MATERIALS,
  productCompositionChapters,
  readProductCompositionAccess,
  loadMaterialProductAccessFacts,
  type ProductComposition,
} from "../../products/index.js";

export function loadProductCompositions(
  prisma: MaterialsPrisma,
  filter:
    | { readonly ids: readonly string[] }
    | { readonly slugs: readonly string[] }
    | { readonly current: true },
  limit: number,
) {
  return new ProductCompositions(prisma).load(filter, limit, {
    async load(ids) {
      const [materials, publications] = await Promise.all([
        prisma.material.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, sourceId: true, publicationState: true },
        }),
        prisma.publishedMaterial.findMany({
          where: { materialId: { in: [...ids] } },
          select: { materialId: true, topicId: true, hasModeVariants: true },
        }),
      ]);
      const published = new Map(
        publications.map((row) => [row.materialId, row]),
      );
      return materials.map((material) => ({
        id: material.id,
        sourceId: material.sourceId,
        published:
          material.publicationState === "published" &&
          published.has(material.id),
        topicId: published.get(material.id)?.topicId ?? null,
        hasModeVariants: published.get(material.id)?.hasModeVariants ?? false,
      }));
    },
  });
}
