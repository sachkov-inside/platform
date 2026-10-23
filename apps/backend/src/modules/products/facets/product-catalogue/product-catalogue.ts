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
    const memberships = await prisma.productMembership.findMany({
      where: { materialId: { in: [...materialIds] } },
      select: { materialId: true, seriesId: true },
    });
    const products = await prisma.product.findMany({
      where: {
        id: { in: [...new Set(memberships.map((entry) => entry.seriesId))] },
      },
      select: { id: true, archivedAt: true },
    });
    const archived = new Set(
      products
        .filter((product) => product.archivedAt !== null)
        .map((product) => product.id),
    );
    return new Map(
      materialIds.flatMap((materialId) => {
        const productIds = memberships
          .filter((entry) => entry.materialId === materialId)
          .map((entry) => entry.seriesId);
        return productIds.length === 0
          ? []
          : [
              [
                materialId,
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
