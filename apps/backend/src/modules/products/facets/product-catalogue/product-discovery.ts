import { z } from "zod";
import { Prisma } from "../../../../infrastructure/prisma/index.js";
import { readProductPage } from "../../shared/product-page-reader.js";
import { productPageHero } from "../../domain/product-page.js";
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
    return this.read(
      handle === undefined ? this.prisma : productsTransaction(handle),
    );
  }

  private async read(prisma: ProductsPrisma) {
    // All Product relationships share this statement's MVCC snapshot, including joined callers.
    // Standalone discovery opens no transaction that could outlive this owner's read.
    const rows = discoverySnapshotSchema.array().parse(
      await prisma.$queryRaw(Prisma.sql`
      with primary_programme as (
        select distinct on (product_id, material_id)
          product_id, material_id, id, ordinal, chapter_id, step_group
        from products.product_programme_placements
        order by product_id, material_id, ordinal
      ), programme_maximum as (
        select product_id, max(ordinal) as ordinal
        from products.product_programme_placements group by product_id
      ), catalogue as (
        select membership.series_id, membership.material_id,
          coalesce(placement.ordinal,
            coalesce(maximum.ordinal, 0) + row_number() over (
              partition by membership.series_id, placement.id is null
              order by membership.material_id
            ))::integer as ordinal,
          placement.chapter_id, placement.step_group
        from products.series_memberships membership
        left join primary_programme placement
          on placement.product_id = membership.series_id
          and placement.material_id = membership.material_id
        left join programme_maximum maximum on maximum.product_id = membership.series_id
      )
      select
        coalesce((select jsonb_agg(jsonb_build_object(
          'id', product.id, 'createdAt', product.created_at, 'name', product.name,
          'slug', product.slug, 'summary', product.summary,
          'archivedAt', product.archived_at, 'coverId', product.cover_id
        ) order by product.id) from products.series product), '[]'::jsonb) as products,
        coalesce((select jsonb_agg(jsonb_build_object(
          'seriesId', membership.series_id, 'materialId', membership.material_id,
          'ordinal', membership.ordinal, 'chapterId', membership.chapter_id,
          'stepGroup', membership.step_group
        ) order by membership.series_id, membership.material_id)
          from catalogue membership), '[]'::jsonb) as memberships,
        coalesce((select jsonb_agg(jsonb_build_object(
          'seriesId', published.series_id, 'materialId', published.material_id,
          'ordinal', coalesce(membership.ordinal, 1)
        ) order by published.series_id, published.material_id)
          from products.published_material_series_memberships published
          left join catalogue membership on membership.series_id = published.series_id
            and membership.material_id = published.material_id), '[]'::jsonb) as "publishedMemberships"
    `),
    );
    const snapshot = rows[0];
    if (snapshot === undefined)
      throw new Error("Product discovery snapshot is missing");
    return snapshot;
  }
}

const discoverySnapshotSchema = z.object({
  products: z.array(
    z.object({
      id: z.uuid(),
      createdAt: z.coerce.date(),
      name: z.string(),
      slug: z.string(),
      summary: z.string(),
      archivedAt: z.coerce.date().nullable(),
      coverId: z.uuid().nullable(),
    }),
  ),
  memberships: z.array(
    z.object({
      seriesId: z.uuid(),
      materialId: z.uuid(),
      ordinal: z.number().int(),
      chapterId: z.uuid().nullable(),
      stepGroup: z.string().nullable(),
    }),
  ),
  publishedMemberships: z.array(
    z.object({
      seriesId: z.uuid(),
      materialId: z.uuid(),
      ordinal: z.number().int(),
    }),
  ),
});
