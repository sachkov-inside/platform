import { randomUUID } from "node:crypto";

import type { MembershipEntitlements } from "../../../membership-entitlements/index.js";
import { grantWorkshopEntitlement } from "../../features/grant-entitlement/grant-entitlement.js";
import { loadCurrentWorkshopCase } from "../../features/load-current-case/load-current-case.js";
import { publishWorkshopCase } from "../../features/publish-case/publish-case.js";
import { revealWorkshopHint } from "../../features/reveal-hint/reveal-hint.js";
import { revealWorkshopSolution } from "../../features/reveal-solution/reveal-solution.js";
import { resolveWorkshopAccess } from "../../features/resolve-access/resolve-access.js";
import { assembleWorkshopMaterialAccess } from "../workshop-material-access/assemble-workshop-material-access.js";
import { assembleWorkshopMaterialProtection } from "../workshop-material-protection/assemble-workshop-material-protection.js";
import type { WorkshopPrismaClient } from "../../infrastructure/prisma.js";
import type { SourceArchives } from "../../ports/source-archives.js";
import type { WorkshopMaterialCatalog } from "../../ports/workshop-material-catalog.js";
import type { WorkshopOwnerPolicy } from "../../ports/workshop-owner-policy.js";
import type { Workshop } from "./workshop.interface.js";

export interface WorkshopDependencies {
  readonly prisma: WorkshopPrismaClient;
  readonly membershipEntitlements: Pick<
    MembershipEntitlements,
    "resolveForAccess"
  >;
  readonly ownerPolicy: WorkshopOwnerPolicy;
  readonly materialCatalog: WorkshopMaterialCatalog;
  readonly sourceArchives: SourceArchives;
  readonly clock?: () => Date;
  readonly id?: () => string;
}

export function assembleWorkshop(dependencies: WorkshopDependencies): Workshop {
  const clock = dependencies.clock ?? (() => new Date());
  const id = dependencies.id ?? randomUUID;
  const materialAccess = assembleWorkshopMaterialAccess({
    prisma: dependencies.prisma,
    clock,
  });
  const workshop: Workshop = {
    materialAccess,
    materialProtection: assembleWorkshopMaterialProtection({
      prisma: dependencies.prisma,
    }),
    grantEntitlement: (command) =>
      grantWorkshopEntitlement(
        {
          prisma: dependencies.prisma,
          membershipEntitlements: dependencies.membershipEntitlements,
          ownerPolicy: dependencies.ownerPolicy,
          clock,
          id,
        },
        command,
      ),
    resolveAccess: (input) =>
      resolveWorkshopAccess(dependencies.prisma, input, clock()),
    publishCase: (command) =>
      publishWorkshopCase(
        {
          prisma: dependencies.prisma,
          ownerPolicy: dependencies.ownerPolicy,
          materialCatalog: dependencies.materialCatalog,
          sourceArchives: dependencies.sourceArchives,
          clock,
          id,
        },
        command,
      ),
    loadCurrentCase: (caseSlug) =>
      loadCurrentWorkshopCase(dependencies.prisma, caseSlug),
    revealHint: (command) =>
      revealWorkshopHint({ prisma: dependencies.prisma, clock, id }, command),
    revealSolution: (command) =>
      revealWorkshopSolution(
        { prisma: dependencies.prisma, clock, id },
        command,
      ),
  };
  return Object.freeze(workshop);
}
