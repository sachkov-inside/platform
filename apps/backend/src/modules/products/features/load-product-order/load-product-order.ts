import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { loadProductOrderSnapshot } from "../../infrastructure/postgres/product-order.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { failure } from "../../shared/application-result.js";
import {
  accountId,
  entityId,
  parseCommand,
} from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import { productOrderVersion } from "../../shared/product-order-version.js";
import type { LoadProductOrderOperation } from "./load-product-order.contract.js";

const querySchema = z
  .object({ actor: accountId, productId: entityId })
  .strict();

export function assembleLoadProductOrder(
  dependencies: ProductAuthoringDependencies,
): LoadProductOrderOperation {
  return async (input) => {
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) {
      return failure({ code: "forbidden" });
    }
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    try {
      const snapshot = await loadProductOrderSnapshot(
        dependencies.prisma,
        parsed.value.productId,
        dependencies.materials,
      );
      if (snapshot === undefined) {
        return failure({ code: "product_not_found" });
      }
      return {
        ok: true,
        value: {
          archived: snapshot.archived,
          chapters: snapshot.chapters,
          items: snapshot.items,
          name: snapshot.name,
          programmePlacements: snapshot.programmePlacements,
          productId: snapshot.productId,
          orderVersion: productOrderVersion(
            snapshot.items,
            snapshot.chapters,
            snapshot.programmePlacements,
          ),
        },
      };
    } catch (error) {
      return failure(
        dependencyFailure(
          { module: "products", operation: "loadProductOrder" },
          error,
          mapPostgresReadError(error),
        ),
      );
    }
  };
}
