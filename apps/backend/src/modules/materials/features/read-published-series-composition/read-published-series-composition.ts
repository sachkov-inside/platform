import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ContentAccess, Subject } from "../../../content-access/index.js";
import {
  loadProductCompositions,
  readProductCompositionAccess,
  MAX_PRODUCT_MATERIALS,
} from "../../shared/product-composition.js";

export type PublishedSeriesCompositionResult =
  | { readonly ok: true; readonly value: readonly string[] }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "series_not_found" }
        | { readonly code: "series_too_large" }
        | { readonly code: "dependency_unavailable" };
    };

export class PublishedSeriesComposition {
  constructor(private readonly prisma: MaterialsPrismaClient) {}

  async read(
    seriesId: string,
    reader?: {
      readonly subject: Subject;
      readonly contentAccess: Pick<ContentAccess, "checkProductAccess">;
    },
  ): Promise<PublishedSeriesCompositionResult> {
    if (!z.uuid().safeParse(seriesId).success)
      return { ok: false, error: { code: "invalid_request" } };
    try {
      const [product] = await loadProductCompositions(
        this.prisma,
        { ids: [seriesId] },
        1,
      );
      if (product === undefined)
        return { ok: false, error: { code: "series_not_found" } };
      const access = await readProductCompositionAccess(product, reader);
      if (access === "unavailable")
        return { ok: false, error: { code: "dependency_unavailable" } };
      if (access === "closed")
        return { ok: false, error: { code: "series_not_found" } };
      if (product.placements.length > MAX_PRODUCT_MATERIALS)
        return { ok: false, error: { code: "series_too_large" } };
      return {
        ok: true,
        value: product.materials.map((material) => material.materialId),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "materials", operation: "read" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } },
      );
    }
  }
}
