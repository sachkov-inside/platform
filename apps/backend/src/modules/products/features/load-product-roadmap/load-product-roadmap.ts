import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type {
  ForbiddenError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type { ProductsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import { failure } from "../../shared/application-result.js";
import {
  accountId,
  entityId,
  parseCommand,
} from "../../shared/command-validation.js";
import {
  productRoadmapSchema,
  type ProductRoadmapReceiptDto,
} from "../../shared/product-roadmap.js";
import type { ProductNotFoundError } from "../load-product-order/load-product-order.contract.js";

const querySchema = z
  .object({ actor: accountId, productId: entityId })
  .strict();

export type LoadProductRoadmapResult = Result<
  ProductRoadmapReceiptDto,
  ForbiddenError | ProductNotFoundError | SystemError
>;
export type LoadProductRoadmapOperation = (
  query: z.input<typeof querySchema>,
) => Promise<LoadProductRoadmapResult>;

/** The stored roadmap of one Product for its author; `null` when none is stored. */
export function assembleLoadProductRoadmap(
  dependencies: ProductAuthoringDependencies,
): LoadProductRoadmapOperation {
  return async (input) => {
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) return failure({ code: "forbidden" });
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) return failure(authorization.error);
    const { productId } = parsed.value;
    try {
      const product = await dependencies.prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (product === null) return failure({ code: "product_not_found" });
      return {
        ok: true,
        value: {
          productId,
          roadmap: await readProductRoadmap(dependencies.prisma, productId),
        },
      };
    } catch (error) {
      return failure(
        dependencyFailure(
          { module: "products", operation: "loadProductRoadmap" },
          error,
          mapPostgresReadError(error),
        ),
      );
    }
  };
}

async function readProductRoadmap(
  prisma: ProductsPrismaClient,
  productId: string,
): Promise<ProductRoadmapReceiptDto["roadmap"]> {
  const row = await prisma.productRoadmap.findUnique({
    where: { productId },
    select: { updatedOn: true, chapters: true },
  });
  if (row === null) return null;
  return productRoadmapSchema.parse({
    updatedOn: row.updatedOn.toISOString().slice(0, 10),
    chapters: row.chapters,
  });
}
