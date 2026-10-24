import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import type { LoadHomePinOperation } from "./load-home-pin.contract.js";

const querySchema = z.object({ actor: accountId }).strict();

export function assembleLoadHomePin(
  dependencies: ProductAuthoringDependencies,
): LoadHomePinOperation {
  return async (input) => {
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) return { ok: false, error: { code: "forbidden" } };
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) return authorization;
    try {
      const pin = await dependencies.prisma.homeSeriesPin.findUniqueOrThrow({
        where: { id: 1 },
        select: { seriesId: true, version: true },
      });
      return { ok: true, value: pin };
    } catch (error) {
      return {
        ok: false,
        error: dependencyFailure(
          { module: "materials", operation: "loadHomePin" },
          error,
          mapPostgresReadError(error),
        ),
      };
    }
  };
}
