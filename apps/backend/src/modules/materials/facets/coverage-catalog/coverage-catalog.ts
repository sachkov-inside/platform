import type { TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { materialsTransaction } from "../../infrastructure/transaction.js";
import type { ProductDiscovery } from "../../../products/index.js";
import { z } from "zod";
import {
  COVERAGE_CATALOG_ENTRY_LIMIT as maximumCatalogEntries,
  COVERAGE_CATALOG_SCOPE_LIMIT,
} from "../../../account-rights/index.js";
import {
  coverageEntrySchema,
  coverageSchema,
} from "@inside/access-capabilities";
import { type MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";

const entriesSchema = z.array(coverageEntrySchema);
/** Metadata only. Knowing a title never authorizes its body, media or artifacts. */
export class CoverageCatalog {
  constructor(
    private readonly prisma: MaterialsPrismaClient,
    private readonly products: Pick<ProductDiscovery, "metadata">,
  ) {}
  async resolveWholePlatformProducts(
    periods: readonly { startsAt: Date; endsAt: Date }[],
  ) {
    if (periods.length > COVERAGE_CATALOG_SCOPE_LIMIT)
      throw new Error("Historical Product periods exceed supported size");
    if (periods.length === 0) return [];
    const products = await this.products.metadata();
    const rows = entriesSchema.parse(
      products
        .filter((product) =>
          periods.some(
            (period) =>
              product.createdAt < period.endsAt &&
              (product.archivedAt === null ||
                product.archivedAt > period.startsAt),
          ),
        )
        .map((product) => ({
          kind: "product",
          id: product.id,
          title: product.name,
          slug: product.archivedAt === null ? product.slug : null,
          available: product.archivedAt === null,
        }))
        .sort(compareEntries),
    );
    if (rows.length > maximumCatalogEntries)
      throw new Error("Historical Product catalog exceeds supported size");
    return rows;
  }
  async list() {
    const products = await this.products.metadata();
    const materials = await this.prisma.material.findMany({
      select: { id: true, title: true, publicationState: true, slug: true },
      take: maximumCatalogEntries + 1,
    });
    const rows = entriesSchema.parse(
      [
        ...products.map((product) => ({
          kind: "product",
          id: product.id,
          title: product.name,
          slug: product.slug,
          available: product.archivedAt === null,
        })),
        ...materials.map((material) => ({
          kind: "material",
          id: material.id,
          title: material.title ?? "Материал без названия",
          slug:
            material.publicationState === "published" ? material.slug : null,
          available: material.publicationState === "published",
        })),
      ].sort(compareEntries),
    );
    if (rows.length > maximumCatalogEntries)
      throw new Error("Content scope catalog exceeds supported size");
    return rows;
  }
  async hasProduct(productId: string, handle?: TransactionHandle) {
    const products = await this.products.metadata({ ids: [productId] }, handle);
    return products.some((product) => product.id === productId.toLowerCase());
  }
  async resolve(input: unknown, handle?: TransactionHandle) {
    const [entries] = await this.resolveMany([input], handle);
    return entries ?? [];
  }

  /** One bounded metadata read for all scopes in an Account view. */
  async resolveMany(inputs: readonly unknown[], handle?: TransactionHandle) {
    const prisma =
      handle === undefined ? this.prisma : materialsTransaction(handle);
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
    const products = await this.products.metadata(
      {
        ids: productIds,
        includeActive: wholePlatform,
      },
      handle,
    );
    const materials =
      materialIds.length === 0
        ? []
        : await prisma.material.findMany({
            where: { id: { in: materialIds } },
            select: {
              id: true,
              title: true,
              publicationState: true,
              slug: true,
            },
          });
    const rows = entriesSchema.parse(
      [
        ...products
          .filter(
            (product) =>
              (wholePlatform && product.archivedAt === null) ||
              productIds.includes(product.id),
          )
          .map((product) => ({
            kind: "product",
            id: product.id,
            title: product.name,
            slug: product.archivedAt === null ? product.slug : null,
            available: product.archivedAt === null,
          })),
        ...materials.map((material) => ({
          kind: "material",
          id: material.id,
          title: material.title ?? "Материал без названия",
          slug:
            material.publicationState === "published" ? material.slug : null,
          available: material.publicationState === "published",
        })),
      ].sort(compareEntries),
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

function compareEntries(
  a: { kind: string; title: string; id: string },
  b: { kind: string; title: string; id: string },
) {
  const kind = a.kind.localeCompare(b.kind);
  if (kind !== 0) return kind;
  const title = a.title.localeCompare(b.title);
  return title !== 0 ? title : a.id.localeCompare(b.id);
}
