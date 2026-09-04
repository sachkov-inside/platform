import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { assembleWorkshopMaterialAccess } from "./facets/workshop-material-access/assemble-workshop-material-access.js";
import type { WorkshopMaterialAccess } from "./facets/workshop-material-access/workshop-material-access.interface.js";
import { assembleWorkshopMaterialProtection } from "./facets/workshop-material-protection/assemble-workshop-material-protection.js";
import type { WorkshopMaterialProtection } from "./facets/workshop-material-protection/workshop-material-protection.interface.js";
import { assembleWorkshopEntitlements } from "./facets/workshop-entitlements/assemble-workshop-entitlements.js";
import type { WorkshopEntitlements } from "./facets/workshop-entitlements/workshop-entitlements.interface.js";
import {
  WORKSHOP_ENTITLEMENTS,
  WORKSHOP_MATERIAL_ACCESS,
  WORKSHOP_MATERIAL_PROTECTION,
} from "./workshop.tokens.js";

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: WORKSHOP_MATERIAL_ACCESS,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): WorkshopMaterialAccess =>
        assembleWorkshopMaterialAccess({ prisma, clock: () => new Date() }),
    },
    {
      provide: WORKSHOP_MATERIAL_PROTECTION,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): WorkshopMaterialProtection =>
        assembleWorkshopMaterialProtection({ prisma }),
    },
    {
      provide: WORKSHOP_ENTITLEMENTS,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): WorkshopEntitlements =>
        assembleWorkshopEntitlements({ prisma }),
    },
  ],
  exports: [
    WORKSHOP_ENTITLEMENTS,
    WORKSHOP_MATERIAL_ACCESS,
    WORKSHOP_MATERIAL_PROTECTION,
  ],
})
export class WorkshopModule {}
