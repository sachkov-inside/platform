import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialId } from "../../../../infrastructure/contracts/material-id.js";
import type { WorkshopPrisma } from "../../infrastructure/prisma.js";

export type WorkshopMaterialProtectionState =
  | "protected"
  | "unprotected"
  | "unavailable";

/**
 * Whether a Workshop Case still uses the Material. It reads in the caller's transaction under the
 * Material reference lock, which Case publication also takes, so a Save cannot open access to a
 * Material that a Case is linking at the same moment.
 */
export async function resolveWorkshopMaterialProtection(
  transaction: Pick<WorkshopPrisma, "workshopCaseMaterial">,
  materialId: MaterialId,
): Promise<WorkshopMaterialProtectionState> {
  if (!z.uuid().safeParse(materialId).success) return "unavailable";
  try {
    const link = await transaction.workshopCaseMaterial.findFirst({
      where: { materialId },
      select: { caseVersionId: true },
    });
    return link === null ? "unprotected" : "protected";
  } catch (error) {
    return dependencyFailure({ module: "workshop", operation: "resolveWorkshopMaterialProtection" }, error, "unavailable");
  }
}
