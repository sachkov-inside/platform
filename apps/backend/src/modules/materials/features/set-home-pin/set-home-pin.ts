import { z } from "zod";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { lockSeries } from "../../infrastructure/postgres/series-order.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { executeAuthoringTransaction } from "../../shared/application-result.js";
import { accountId, entityId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type { HomePinDto } from "../load-home-pin/load-home-pin.contract.js";
import type { SetHomePinError, SetHomePinOperation } from "./set-home-pin.contract.js";

const commandSchema = z.object({ actor: accountId, seriesId: entityId.nullable(), expectedVersion: z.number().int().positive() }).strict();

export function assembleSetHomePin(dependencies: MaterialAuthoringDependencies): SetHomePinOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
    if (!parsed.ok) return parsed;
    const command = parsed.value;
    const authorization = await authorizeManager(dependencies.authorPolicy, command.actor);
    if (!authorization.ok) return authorization;
    return executeAuthoringTransaction<HomePinDto, SetHomePinError>(dependencies.prisma, async (transaction, rollback) => {
      if (command.seriesId !== null) {
        await lockSeries(transaction, [command.seriesId]);
        const series = await transaction.series.findUnique({ where: { id: command.seriesId }, select: { archivedAt: true } });
        if (series === null || series.archivedAt !== null) return rollback({ code: "invalid_reference", issues: [{ code: "series_not_available", path: "/seriesId" }] });
        const count = await transaction.publishedMaterialSeriesMembership.count({ where: { seriesId: command.seriesId } });
        if (count === 0) return rollback({ code: "invalid_reference", issues: [{ code: "series_has_no_published_materials", path: "/seriesId" }] });
      }
      const updated = await transaction.homeSeriesPin.updateMany({
        where: { id: 1, version: command.expectedVersion },
        data: { seriesId: command.seriesId, version: { increment: 1 } },
      });
      if (updated.count === 0) return rollback({ code: "stale_home_pin" });
      return { seriesId: command.seriesId, version: command.expectedVersion + 1 };
    }, mapPostgresReadError);
  };
}
