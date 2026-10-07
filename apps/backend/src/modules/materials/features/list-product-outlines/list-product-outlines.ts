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

  async list(): Promise<ProductOutlinesResult> {
    try {
      const products = await loadProductCompositions(
        this.prisma,
        { current: true },
        MAX_PRODUCTS + 1,
      );
      const rows = rowsSchema.parse(
        products.map((product) => ({
          id: product.id,
          name: product.name,
          chapters: productCompositionChapters(product).map(
            ({ id, name, materialIds }) => ({ id, name, materialIds }),
          ),
        })),
      );
      if (rows.length > MAX_PRODUCTS)
        return { ok: false, error: { code: "products_too_many" } };
      return { ok: true, value: rows };
    } catch (error) {
      return dependencyFailure(
        { module: "materials", operation: "listProductOutlines" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }
}
