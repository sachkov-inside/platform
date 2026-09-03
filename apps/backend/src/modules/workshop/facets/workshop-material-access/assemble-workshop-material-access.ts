import { z } from "zod";

import type { WorkshopPrisma } from "../../infrastructure/prisma.js";
import { resolveCurrentCaseVersionAccess } from "../../shared/current-case-version-access.js";
import type {
  WorkshopMaterialAccess,
  WorkshopMaterialAccessState,
} from "./workshop-material-access.interface.js";

export function assembleWorkshopMaterialAccess(dependencies: {
  readonly prisma: WorkshopPrisma;
  readonly clock: () => Date;
}): WorkshopMaterialAccess {
  const materialAccess: WorkshopMaterialAccess = {
    async resolve(accountId, materialId): Promise<WorkshopMaterialAccessState> {
      if (
        !z.uuid().safeParse(accountId).success ||
        !z.uuid().safeParse(materialId).success
      ) {
        return { availability: "unavailable" };
      }
      try {
        const links = await dependencies.prisma.workshopCaseMaterial.findMany({
          where: { materialId },
          include: { caseVersion: { include: { currentFor: true } } },
        });
        let locked = false;
        for (const link of links) {
          const access = await resolveCurrentCaseVersionAccess(
            dependencies.prisma,
            accountId,
            link.caseVersionId,
            dependencies.clock(),
          );
          if (access === undefined) continue;
          if (link.releasePolicy === "immediate") {
            return { availability: "available", validUntil: access.validUntil };
          }
          if (link.releasePolicy === "hint_reveal" && link.hintKey !== null) {
            const reveal = await dependencies.prisma.workshopHintReveal.findUnique({
              where: {
                accountId_caseVersionId_hintKey: {
                  accountId,
                  caseVersionId: link.caseVersionId,
                  hintKey: link.hintKey,
                },
              },
              select: { id: true },
            });
            if (reveal !== null) {
              return { availability: "available", validUntil: access.validUntil };
            }
            locked = true;
          }
          if (link.releasePolicy === "solution_reveal") {
            const reveal = await dependencies.prisma.workshopSolutionReveal.findUnique({
              where: {
                accountId_caseVersionId: {
                  accountId,
                  caseVersionId: link.caseVersionId,
                },
              },
              select: { id: true },
            });
            if (reveal !== null) {
              return { availability: "available", validUntil: access.validUntil };
            }
            locked = true;
          }
        }
        return { availability: locked ? "locked" : "unavailable" };
      } catch {
        return { availability: "unavailable" };
      }
    },
  };
  return Object.freeze(materialAccess);
}
