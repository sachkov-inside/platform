import { readProductPage } from "../../shared/product-page-reader.js";
import { productPageHero } from "../../domain/product-page.js";
import type {
  ProductsPrisma,
  ProductsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { productsTransaction } from "../../infrastructure/transaction.js";

/** Current discovery facts. Consumers combine these values with their own publication snapshot. */
export class ProductDiscovery {
  constructor(private readonly prisma: ProductsPrismaClient) {}

  async homePin() {
    const pin = await this.prisma.homeSeriesPin.findUniqueOrThrow({
      where: { id: 1 },
      select: { seriesId: true },
    });
    if (pin.seriesId === null) return null;
    const product = await this.prisma.product.findUnique({
      where: { id: pin.seriesId },
      select: { page: true, presentation: true, slug: true },
    });
    if (product === null) return null;
    const page = readProductPage(
      product.page,
      `Home pinned Product ${product.slug}`,
    );
    return {
      id: pin.seriesId,
      presentation: product.presentation,
      card: page?.card ?? null,
      hero: productPageHero(page),
    };
  }

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
          createdAt: true,
          name: true,
          slug: true,
          summary: true,
          archivedAt: true,
          coverId: true,
        },
      }),
      prisma.productMembership.findMany({
        select: {
          seriesId: true,
          materialId: true,
          ordinal: true,
          chapterId: true,
          stepGroup: true,
        },
      }),
      prisma.publishedMaterialProductMembership.findMany({
        select: { seriesId: true, materialId: true, ordinal: true },
      }),
    ]);
    return { products, memberships, publishedMemberships };
  }
}
