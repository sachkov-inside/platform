import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import {
  loadSeriesOrderSnapshot,
  lockSeries,
  replaceSeriesOrder,
} from "../../infrastructure/postgres/series-order.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { accountId, entityId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { seriesOrderVersion } from "../../shared/series-order-version.js";
import type {
  ReorderSeriesError,
  ReorderSeriesOperation,
  ReorderSeriesReceiptDto,
} from "./reorder-series.contract.js";

const commandSchema = z
  .object({
    actor: accountId,
    expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    orderedMaterialIds: z.array(entityId),
    seriesId: entityId,
  })
  .strict()
  .refine(
    ({ orderedMaterialIds }) =>
      new Set(orderedMaterialIds).size === orderedMaterialIds.length,
    { path: ["orderedMaterialIds"], message: "Material IDs must be unique" },
  );

export function assembleReorderSeries(
  dependencies: MaterialAuthoringDependencies,
): ReorderSeriesOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }

    return executeAuthoringTransaction<
      ReorderSeriesReceiptDto,
      ReorderSeriesError
    >(
      dependencies.prisma,
      async (transaction, rollback) => {
        await lockSeries(transaction, [command.seriesId]);
        const snapshot = await loadSeriesOrderSnapshot(
          transaction,
          command.seriesId,
        );
        if (snapshot === undefined) {
          return rollback({ code: "series_not_found" });
        }
        const currentIds = snapshot.items.map(({ materialId }) => materialId);
        const currentOrderVersion = seriesOrderVersion(currentIds);
        if (sameOrder(currentIds, command.orderedMaterialIds)) {
          return { seriesId: command.seriesId, orderVersion: currentOrderVersion };
        }
        if (currentOrderVersion !== command.expectedOrderVersion) {
          return rollback({ code: "stale_series_order", currentOrderVersion });
        }
        if (snapshot.archived) {
          const currentSet = new Set(currentIds);
          const addedIndex = command.orderedMaterialIds.findIndex(
            (materialId) => !currentSet.has(materialId),
          );
          if (addedIndex >= 0) {
            return rollback({
              code: "invalid_reference",
              issues: [
                {
                  code: "series_archived",
                  path: `/orderedMaterialIds/${String(addedIndex)}`,
                },
              ],
            });
          }
        }
        const foundMaterials =
          command.orderedMaterialIds.length === 0
            ? []
            : await transaction.material.findMany({
                where: { id: { in: [...command.orderedMaterialIds] } },
                select: { id: true },
              });
        const foundMaterialIds = new Set(foundMaterials.map(({ id }) => id));
        const missingIndex = command.orderedMaterialIds.findIndex(
          (materialId) => !foundMaterialIds.has(materialId),
        );
        if (missingIndex >= 0) {
          return rollback({
            code: "invalid_reference",
            issues: [
              {
                code: "material_not_found",
                path: `/orderedMaterialIds/${String(missingIndex)}`,
              },
            ],
          });
        }
        await replaceSeriesOrder(
          transaction,
          command.seriesId,
          command.orderedMaterialIds,
        );
        return {
          seriesId: command.seriesId,
          orderVersion: seriesOrderVersion(command.orderedMaterialIds),
        };
      },
      mapPostgresReadError,
    );
  };
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
