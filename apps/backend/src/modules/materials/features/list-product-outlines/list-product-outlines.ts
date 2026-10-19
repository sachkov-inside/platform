import {
  DIAGNOSTIC_SOURCE_ROW_LIMIT,
  diagnosticSnapshotOptions,
  diagnosticSourceBudgetFailure,
  setDiagnosticStatementBudget,
  type DiagnosticSourceBudgetFailure,
} from "../../../../infrastructure/diagnostic-read-budget.js";
import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  loadProductCompositions,
  productCompositionChapters,
} from "../../shared/product-composition.js";

// A report selector lists every Product at once; the bound only stops a runaway catalog.
const MAX_PRODUCTS = 200;

const rowsSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    chapters: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        materialIds: z.array(z.uuid()),
      }),
    ),
  }),
);

export type ProductOutline = z.infer<typeof rowsSchema>[number];
export type ProductOutlinesResult =
  | { readonly ok: true; readonly value: readonly ProductOutline[] }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "products_too_many" | "dependency_unavailable";
      };
    };

/**
 * Current Products with their chapters in author order and the published, reader-visible
 * Materials of each chapter: the same composition the Product programme shows.
 */
export class ProductOutlines {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  list(): Promise<ProductOutlinesResult> {
    return readProductOutlines(this.prisma);
  }

  async listForDiagnostics(): Promise<
    ProductOutlinesResult | DiagnosticSourceBudgetFailure
  > {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await setDiagnosticStatementBudget(transaction);
        const products = await transaction.product.findMany({
          where: { archivedAt: null },
          take: MAX_PRODUCTS + 1,
          select: { id: true },
        });
        if (products.length > MAX_PRODUCTS)
          return {
            ok: false as const,
            error: { code: "products_too_many" as const },
          };
        const productIds = products.map((product) => product.id);
        const sources = await Promise.all([
          transaction.productProgrammePlacement.findMany({
            where: { productId: { in: productIds } },
            take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
            select: { id: true },
          }),
          transaction.productChapter.findMany({
            where: { productId: { in: productIds } },
            take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
            select: { id: true },
          }),
          transaction.productChapterSupplementaryMaterial.findMany({
            where: { productId: { in: productIds } },
            take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
            select: { materialId: true },
          }),
          transaction.productMembership.findMany({
            where: { seriesId: { in: productIds } },
            take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
            select: { materialId: true },
          }),
          transaction.publishedMaterialProductMembership.findMany({
            where: { seriesId: { in: productIds } },
            take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
            select: { materialId: true },
          }),
        ]);
        if (sources.some((rows) => rows.length > DIAGNOSTIC_SOURCE_ROW_LIMIT))
          return diagnosticSourceBudgetFailure;
        return readProductOutlines(transaction, "listForDiagnostics");
      }, diagnosticSnapshotOptions);
    } catch (error) {
      return dependencyFailure(
        { module: "materials", operation: "listForDiagnostics" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}

async function readProductOutlines(
  prisma: MaterialsPrisma,
  operation = "listProductOutlines",
): Promise<ProductOutlinesResult> {
  try {
    const products = await loadProductCompositions(
      prisma,
      { current: true },
      MAX_PRODUCTS + 1,
    );
    const rows = rowsSchema.parse(
      products.map((product) => ({
        id: product.id,
        name: product.name,
        chapters: productCompositionChapters(product).map(
          ({ id, name, materialIds }) => ({
            id,
            name,
            materialIds: [...new Set(materialIds)],
          }),
        ),
      })),
    );
    if (rows.length > MAX_PRODUCTS)
      return { ok: false, error: { code: "products_too_many" } };
    return { ok: true, value: rows };
  } catch (error) {
    return dependencyFailure({ module: "materials", operation }, error, {
      ok: false,
      error: { code: "dependency_unavailable" },
    } as const);
  }
}
