import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { loadSeriesOrderSnapshot } from "../../infrastructure/postgres/series-order.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, entityId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { seriesOrderVersion } from "../../shared/series-order-version.js";
import type { LoadSeriesOrderOperation } from "./load-series-order.contract.js";

const querySchema = z
  .object({ actor: accountId, seriesId: entityId })
  .strict();

export function assembleLoadSeriesOrder(
  dependencies: MaterialAuthoringDependencies,
): LoadSeriesOrderOperation {
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
      const snapshot = await loadSeriesOrderSnapshot(
        dependencies.prisma,
        parsed.value.seriesId,
      );
      if (snapshot === undefined) {
        return failure({ code: "series_not_found" });
      }
      return {
        ok: true,
        value: {
          ...snapshot,
          orderVersion: seriesOrderVersion(
            snapshot.items.map(({ materialId }) => materialId),
          ),
        },
      };
    } catch (error) {
      return failure(mapPostgresReadError(error));
    }
  };
}
