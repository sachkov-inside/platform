import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { assembleWorkshopMaterialAccess } from "./facets/workshop-material-access/assemble-workshop-material-access.js";
import type { WorkshopMaterialAccess } from "./facets/workshop-material-access/workshop-material-access.interface.js";
import { assembleWorkshopEntitlements } from "./facets/workshop-entitlements/assemble-workshop-entitlements.js";
import type { WorkshopEntitlements } from "./facets/workshop-entitlements/workshop-entitlements.interface.js";
import {
  WORKSHOP_ENTITLEMENTS,
  WORKSHOP_MATERIAL_ACCESS,
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
      provide: WORKSHOP_ENTITLEMENTS,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): WorkshopEntitlements =>
        assembleWorkshopEntitlements({ prisma }),
    },
  ],
  exports: [
    WORKSHOP_ENTITLEMENTS,
    WORKSHOP_MATERIAL_ACCESS,
  ],
})
export class WorkshopModule {}
