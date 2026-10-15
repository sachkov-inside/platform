import { z } from "zod";
import {
  COVERAGE_CATALOG_ENTRY_LIMIT as maximumCatalogEntries,
  COVERAGE_CATALOG_SCOPE_LIMIT,
} from "../../../account-rights/index.js";
import {
  coverageEntrySchema,
  coverageSchema,
} from "@inside/access-capabilities";
import {
  Prisma,
  type MaterialsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

const entriesSchema = z.array(coverageEntrySchema);
/** Metadata only. Knowing a title never authorizes its body, media or artifacts. */
export class CoverageCatalog {
  constructor(private readonly prisma: MaterialsPrismaClient) {}
  async resolveWholePlatformProducts(
    periods: readonly { startsAt: Date; endsAt: Date }[],
  ) {
    if (periods.length > COVERAGE_CATALOG_SCOPE_LIMIT)
      throw new Error("Historical Product periods exceed supported size");
    if (periods.length === 0) return [];
    const rows = entriesSchema.parse(
      await this.prisma.$queryRaw(Prisma.sql`
      SELECT 'product' AS kind, product.id, product.name AS title,
        CASE WHEN product.archived_at IS NULL THEN product.slug ELSE NULL END AS slug,
        product.archived_at IS NULL AS available
      FROM materials.series AS product
      WHERE ${Prisma.join(
        periods.map(
          (period) => Prisma.sql`(
        product.created_at < ${period.endsAt}
        AND (product.archived_at IS NULL OR product.archived_at > ${period.startsAt})
      )`,
        ),
        " OR ",
      )}
      ORDER BY product.name, product.id LIMIT ${maximumCatalogEntries + 1}
    `),
    );
    if (rows.length > maximumCatalogEntries)
      throw new Error("Historical Product catalog exceeds supported size");
    return rows;
  }
  async list() {
    const rows = entriesSchema.parse(
      await this.prisma.$queryRaw(Prisma.sql`
      SELECT 'product' AS kind, id, name AS title, slug, archived_at IS NULL AS available FROM materials.series
      UNION ALL
      SELECT 'material' AS kind, id, coalesce(title, 'Материал без названия') AS title,
        CASE WHEN publication_state = 'published' THEN slug ELSE NULL END AS slug,
        publication_state = 'published' AS available FROM materials.materials
      ORDER BY kind, title, id LIMIT ${maximumCatalogEntries + 1}
    `),
    );
    if (rows.length > maximumCatalogEntries)
      throw new Error("Content scope catalog exceeds supported size");
    return rows;
  }
  async resolve(input: unknown) {
    const [entries] = await this.resolveMany([input]);
    return entries ?? [];
  }

  /** One bounded metadata read for all scopes in an Account view. */
  async resolveMany(inputs: readonly unknown[]) {
    if (inputs.length > COVERAGE_CATALOG_SCOPE_LIMIT)
      throw new Error("Content scope batch exceeds supported size");
    const scopes = inputs.map((input) => coverageSchema.parse(input));
    if (scopes.length === 0) return [];
    const productIds = [
      ...new Set(
        scopes.flatMap((scope) =>
          scope.productIds.map((id) => id.toLowerCase()),
        ),
      ),
    ];
    const materialIds = [
      ...new Set(
        scopes.flatMap((scope) =>
          scope.materialIds.map((id) => id.toLowerCase()),
        ),
      ),
    ];
    if (productIds.length + materialIds.length > maximumCatalogEntries)
      throw new Error("Content scope catalog exceeds supported size");
    const wholePlatform = scopes.some((scope) => scope.wholePlatform === true);
    const rows = entriesSchema.parse(
      await this.prisma.$queryRaw(Prisma.sql`
      SELECT 'product' AS kind, id, name AS title, CASE WHEN archived_at IS NULL THEN slug ELSE NULL END AS slug, archived_at IS NULL AS available
        FROM materials.series WHERE (${wholePlatform}::boolean AND archived_at IS NULL) OR id = ANY(${productIds}::uuid[])
      UNION ALL
      SELECT 'material' AS kind, id, coalesce(title, 'Материал без названия') AS title,
        CASE WHEN publication_state = 'published' THEN slug ELSE NULL END AS slug, publication_state = 'published' AS available
        FROM materials.materials WHERE id = ANY(${materialIds}::uuid[])
      ORDER BY kind, title, id LIMIT ${maximumCatalogEntries + 1}
    `),
    );
    if (rows.length > maximumCatalogEntries)
      throw new Error("Content scope catalog exceeds supported size");
    const references = new Set([
      ...rows.map((row) => `${row.kind}/${row.id}`),
      ...productIds.map((id) => `product/${id}`),
      ...materialIds.map((id) => `material/${id}`),
    ]);
    if (references.size > maximumCatalogEntries)
      throw new Error("Content scope catalog exceeds supported size");
    const byReference = new Map(
      rows.map((row) => [`${row.kind}/${row.id}`, row]),
    );
    const activeProducts = rows.filter(
      (row) => row.kind === "product" && row.available,
    );
    return scopes.map((scope) => {
      const productItems =
        scope.wholePlatform === true
          ? activeProducts.map((row) => ({
              id: row.id,
              kind: "product" as const,
            }))
          : scope.productIds.map((id) => ({ id, kind: "product" as const }));
      return [
        ...productItems,
        ...scope.materialIds.map((id) => ({ id, kind: "material" as const })),
      ].map(
        (item) =>
          byReference.get(`${item.kind}/${item.id.toLowerCase()}`) ?? {
            ...item,
            title: "Позиция временно недоступна",
            slug: null,
            available: false,
          },
      );
    });
  }
}
