import { z } from "zod";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import { readProductPage } from "../../shared/product-page-reader.js";
import { productPageHero } from "../../domain/product-page.js";
import { loadCatalogueMemberships } from "../../infrastructure/postgres/catalogue-memberships.js";
import type {
  ProductsPrisma,
  ProductsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { productsTransaction } from "../../infrastructure/transaction.js";

export interface ProductMetadataFact {
  readonly id: string;
  readonly createdAt: Date;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly archivedAt: Date | null;
  readonly coverId: string | null;
}
export interface ProductCatalogueMembershipFact {
  readonly seriesId: string;
  readonly materialId: string;
}

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

  async metadata(query?: {
    readonly ids?: readonly string[];
    readonly slugs?: readonly string[];
    readonly includeActive?: boolean;
  }): Promise<ProductMetadataFact[]> {
    return this.prisma.product.findMany({
      ...(query === undefined
        ? {}
        : {
            where: {
              OR: [
                ...(query.ids === undefined
                  ? []
                  : [{ id: { in: [...query.ids] } }]),
                ...(query.slugs === undefined
                  ? []
                  : [{ slug: { in: [...query.slugs] } }]),
                ...(query.includeActive === true ? [{ archivedAt: null }] : []),
              ],
            },
          }),
      select: {
        id: true,
        createdAt: true,
        name: true,
        slug: true,
        summary: true,
        archivedAt: true,
        coverId: true,
      },
    });
  }

  async siteCandidates() {
    return z
      .array(
        z.object({
          id: z.uuid(),
          slug: z.string(),
          name: z.string(),
          materialIds: z.array(z.uuid()),
        }),
      )
      .parse(
        await this.prisma.$queryRaw(Prisma.sql`
        select product.id, product.slug, product.name,
          coalesce(array_agg(membership.material_id order by membership.material_id)
            filter (where membership.material_id is not null), array[]::uuid[]) as "materialIds"
        from products.series as product
        left join products.published_material_series_memberships as membership on membership.series_id = product.id
        where product.archived_at is null
        group by product.id
        order by product.name, product.id
      `),
      );
  }

  async catalogueMemberships(
    productIds: readonly string[],
  ): Promise<ProductCatalogueMembershipFact[]> {
    return this.prisma.productMembership.findMany({
      where: { seriesId: { in: [...productIds] } },
      select: { seriesId: true, materialId: true },
    });
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
      loadCatalogueMemberships(prisma),
      prisma.publishedMaterialProductMembership.findMany({
        select: { seriesId: true, materialId: true },
      }),
    ]);
    const ordinalByPair = new Map(
      memberships.map((entry) => [
        `${entry.seriesId}/${entry.materialId}`,
        entry.ordinal,
      ]),
    );
    return {
      products,
      memberships,
      publishedMemberships: publishedMemberships.map((entry) => ({
        ...entry,
        ordinal:
          ordinalByPair.get(`${entry.seriesId}/${entry.materialId}`) ?? 1,
      })),
    };
  }
}
