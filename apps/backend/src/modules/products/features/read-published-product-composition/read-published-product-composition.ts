import type { ProductMaterialReading } from "../../ports/product-material-reading.js";
import { ProductCompositionsReading } from "../../facets/product-compositions-reading/product-compositions-reading.js";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ProductsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess, Subject } from "../../../content-access/index.js";
import {
  ProductCompositionLimitError,
  readProductCompositionAccess,
  MAX_PRODUCT_MATERIALS,
} from "../../facets/product-compositions/product-compositions.js";

export type PublishedProductCompositionResult =
  | { readonly ok: true; readonly value: readonly string[] }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "product_not_found" }
        | { readonly code: "product_too_large" }
        | { readonly code: "dependency_unavailable" };
    };

export class PublishedProductComposition {
  constructor(
    prisma: ProductsPrismaClient,
    materials: ProductMaterialReading,
    private readonly compositions = new ProductCompositionsReading(
      prisma,
      materials,
    ),
  ) {}

  read(
    productId: string,
    reader?: {
      readonly subject: Subject;
      readonly contentAccess: Pick<ContentAccess, "checkProductAccess">;
    },
  ): Promise<PublishedProductCompositionResult> {
    return this.readOpen(productId, (product) =>
      readProductCompositionAccess(product, reader),
    );
  }

  /**
   * The same published programme for an owner read, whose caller has checked the right: an
   * archived Product keeps its programme, so its holders' progress stays readable.
   */
  readIncludingArchived(
    productId: string,
  ): Promise<PublishedProductCompositionResult> {
    return this.readOpen(productId, () => Promise.resolve("open"));
  }

  private async readOpen(
    productId: string,
    access: (
      product: Parameters<typeof readProductCompositionAccess>[0],
    ) => ReturnType<typeof readProductCompositionAccess>,
  ): Promise<PublishedProductCompositionResult> {
    if (!z.uuid().safeParse(productId).success)
      return { ok: false, error: { code: "invalid_request" } };
    try {
      const [product] = await this.compositions.load({ ids: [productId] }, 1);
      if (product === undefined)
        return { ok: false, error: { code: "product_not_found" } };
      const decision = await access(product);
      if (decision === "unavailable")
        return { ok: false, error: { code: "dependency_unavailable" } };
      if (decision === "closed")
        return { ok: false, error: { code: "product_not_found" } };
      if (product.placements.length > MAX_PRODUCT_MATERIALS)
        return { ok: false, error: { code: "product_too_large" } };
      return {
        ok: true,
        value: [
          ...new Set(
            product.publishedProgramme.map((placement) => placement.materialId),
          ),
        ],
      };
    } catch (error) {
      if (error instanceof ProductCompositionLimitError)
        return { ok: false, error: { code: "product_too_large" } };
      return dependencyFailure(
        { module: "products", operation: "read" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } },
      );
    }
  }
}
