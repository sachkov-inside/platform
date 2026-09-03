import { z } from "zod";

import type { WorkshopPrisma } from "../../infrastructure/prisma.js";
import type {
  WorkshopMaterialProtection,
  WorkshopMaterialProtectionState,
} from "./workshop-material-protection.interface.js";

export function assembleWorkshopMaterialProtection(dependencies: {
  readonly prisma: WorkshopPrisma;
}): WorkshopMaterialProtection {
  const materialProtection: WorkshopMaterialProtection = {
    async resolve(materialId): Promise<WorkshopMaterialProtectionState> {
      if (!z.uuid().safeParse(materialId).success) return "unavailable";
      try {
        const link = await dependencies.prisma.workshopCaseMaterial.findFirst({
          where: { materialId },
          select: { caseVersionId: true },
        });
        return link === null ? "unprotected" : "protected";
      } catch {
        return "unavailable";
      }
    },
  };
  return Object.freeze(materialProtection);
}
