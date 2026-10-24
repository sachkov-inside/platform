import type { ProductsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { productsTransaction } from "../../infrastructure/transaction.js";

export interface MaterialProductAccessFacts {
  readonly productIds: readonly string[];
  readonly archivedOnly?: true;
}

/** Product ownership and archive facts contain no Material content or publication authority. */
export class ProductCatalogue {
  constructor(private readonly prisma: ProductsPrismaClient) {}

  async materialAccessFacts(
    materialIds: readonly string[],
    handle?: TransactionHandle,
  ): Promise<ReadonlyMap<string, MaterialProductAccessFacts>> {
    const prisma =
      handle === undefined ? this.prisma : productsTransaction(handle);
    const canonicalIds = [
      ...new Set(materialIds.map((id) => id.toLowerCase())),
    ];
    const memberships = await prisma.productMembership.findMany({
      where: { materialId: { in: canonicalIds } },
      select: { materialId: true, productId: true },
    });
    const products = await prisma.product.findMany({
      where: {
        id: { in: [...new Set(memberships.map((entry) => entry.productId))] },
      },
      select: { id: true, archivedAt: true },
    });
    const archived = new Set(
      products
        .filter((product) => product.archivedAt !== null)
        .map((product) => product.id),
    );
    const productsByMaterial = new Map<string, string[]>();
    for (const membership of memberships) {
      const productIds = productsByMaterial.get(membership.materialId) ?? [];
      productIds.push(membership.productId);
      productsByMaterial.set(membership.materialId, productIds);
    }
    return new Map(
      materialIds.flatMap((requestedId) => {
        const productIds = productsByMaterial.get(requestedId.toLowerCase());
        return productIds === undefined
          ? []
          : [
              [
                requestedId,
                {
                  productIds,
                  ...(productIds.every((id) => archived.has(id))
                    ? { archivedOnly: true as const }
                    : {}),
                },
              ] as const,
            ];
      }),
    );
  }
}
