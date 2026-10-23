import { loadCatalogueMemberships } from "../../infrastructure/postgres/catalogue-memberships.js";
import type {
  ProductsPrisma,
  ProductsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { productsTransaction } from "../../infrastructure/transaction.js";

/** Current discovery facts. Consumers combine these values with their own publication snapshot. */
export class ProductDiscovery {
  constructor(private readonly prisma: ProductsPrismaClient) {}

  snapshot(handle?: TransactionHandle) {
    return handle === undefined
      ? this.prisma.$transaction((tx) => this.read(tx))
      : this.read(productsTransaction(handle));
  }

  private async read(prisma: ProductsPrisma) {
    const [products, memberships, publishedMemberships] = await Promise.all([
      prisma.product.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          summary: true,
          archivedAt: true,
          coverId: true,
        },
      }),
      loadCatalogueMemberships(prisma),
      prisma.publishedMaterialProductMembership.findMany({
        select: { seriesId: true, materialId: true },
      }),
    ]);
    return {
      products,
      memberships,
      publishedMemberships: publishedMemberships.map((entry) => ({
        ...entry,
        ordinal:
          memberships.find(
            (membership) =>
              membership.seriesId === entry.seriesId &&
              membership.materialId === entry.materialId,
          )?.ordinal ?? 1,
      })),
    };
  }
}
