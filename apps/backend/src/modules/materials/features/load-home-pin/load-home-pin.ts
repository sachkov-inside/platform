import { z } from "zod";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type { LoadHomePinOperation } from "./load-home-pin.contract.js";

const querySchema = z.object({ actor: accountId }).strict();

export function assembleLoadHomePin(dependencies: MaterialAuthoringDependencies): LoadHomePinOperation {
  return async (input) => {
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) return { ok: false, error: { code: "forbidden" } };
    const authorization = await authorizeManager(dependencies.authorPolicy, parsed.value.actor);
    if (!authorization.ok) return authorization;
    try {
      const pin = await dependencies.prisma.homeSeriesPin.findUniqueOrThrow({ where: { id: 1 }, select: { seriesId: true, version: true } });
      return { ok: true, value: pin };
    } catch (error) {
      return { ok: false, error: mapPostgresReadError(error) };
    }
  };
}
