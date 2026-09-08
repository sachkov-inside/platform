import { z } from "zod";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { materialId } from "../../domain/material-identifiers.js";
import { lockMaterialForLifecycleChange } from "../../infrastructure/postgres/material-locks.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { executeAuthoringTransaction } from "../../shared/application-result.js";
import { accountId, entityId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type { HomePinDto } from "../load-home-pin/load-home-pin.contract.js";
import type { SetHomePinError, SetHomePinOperation } from "./set-home-pin.contract.js";

const commandSchema = z.object({ actor: accountId, materialId: entityId.nullable(), expectedVersion: z.number().int().positive() }).strict();

export function assembleSetHomePin(dependencies: MaterialAuthoringDependencies): SetHomePinOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
    if (!parsed.ok) return parsed;
    const command = parsed.value;
    const authorization = await authorizeManager(dependencies.authorPolicy, command.actor);
    if (!authorization.ok) return authorization;
    return executeAuthoringTransaction<HomePinDto, SetHomePinError>(dependencies.prisma, async (transaction, rollback) => {
      if (command.materialId !== null) {
        const material = await lockMaterialForLifecycleChange(transaction, materialId(command.materialId));
        if (material === undefined) return rollback({ code: "material_not_found" });
        if (material.lifecycle.publicationState !== "published") return rollback({ code: "invalid_reference", issues: [{ code: "material_not_published", path: "/materialId" }] });
      }
      const updated = await transaction.homeMaterialPin.updateMany({
        where: { id: 1, version: command.expectedVersion },
        data: { materialId: command.materialId, version: { increment: 1 } },
      });
      if (updated.count === 0) return rollback({ code: "stale_home_pin" });
      return { materialId: command.materialId, version: command.expectedVersion + 1 };
    }, mapPostgresReadError);
  };
}
