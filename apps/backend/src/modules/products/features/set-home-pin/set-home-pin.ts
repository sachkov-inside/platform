import { transactionHandle } from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { lockProduct } from "../../infrastructure/postgres/product-order.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { executeAuthoringTransaction } from "../../shared/application-result.js";
import {
  accountId,
  entityId,
  parseCommand,
} from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import type { HomePinDto } from "../load-home-pin/load-home-pin.contract.js";
import type {
  SetHomePinError,
  SetHomePinOperation,
} from "./set-home-pin.contract.js";

const commandSchema = z
  .object({
    actor: accountId,
    productId: entityId.nullable(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export function assembleSetHomePin(
  dependencies: ProductAuthoringDependencies,
): SetHomePinOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
    if (!parsed.ok) return parsed;
    const command = parsed.value;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) return authorization;
    return executeAuthoringTransaction<HomePinDto, SetHomePinError>(
      dependencies.prisma,
      async (transaction, rollback) => {
        const authorized = await authorizeManager(
          dependencies.authorPolicy,
          command.actor,
          transactionHandle(transaction),
        );
        if (!authorized.ok) return rollback(authorized.error);
        if (command.productId !== null) {
          await lockProduct(transaction, [command.productId]);
          const product = await transaction.product.findUnique({
            where: { id: command.productId },
            select: { archivedAt: true },
          });
          if (product?.archivedAt !== null)
            return rollback({
              code: "invalid_reference",
              issues: [{ code: "product_not_available", path: "/productId" }],
            });
          const count =
            await transaction.publishedMaterialProductMembership.count({
              where: { productId: command.productId },
            });
          if (count === 0)
            return rollback({
              code: "invalid_reference",
              issues: [
                {
                  code: "product_has_no_published_materials",
                  path: "/productId",
                },
              ],
            });
        }
        const updated = await transaction.homeProductPin.updateMany({
          where: { id: 1, version: command.expectedVersion },
          data: { productId: command.productId, version: { increment: 1 } },
        });
        if (updated.count === 0) return rollback({ code: "stale_home_pin" });
        return {
          productId: command.productId,
          version: command.expectedVersion + 1,
        };
      },
      mapPostgresReadError,
      "setHomePin",
    );
  };
}
