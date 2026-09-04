import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  WORKSHOP_ENTITLEMENTS,
  WorkshopModule,
  type WorkshopEntitlements,
} from "../workshop/index.js";
import { assembleMembershipEntitlements } from "./facets/membership-entitlements/assemble-membership-entitlements.js";
import { MEMBERSHIP_ENTITLEMENTS } from "./membership-entitlements.token.js";

@Module({
  imports: [PrismaModule, WorkshopModule],
  providers: [
    {
      provide: MEMBERSHIP_ENTITLEMENTS,
      inject: [PrismaClientProvider, WORKSHOP_ENTITLEMENTS],
      useFactory: (
        prisma: PrismaClientProvider,
        workshopEntitlements: WorkshopEntitlements,
      ) => assembleMembershipEntitlements({ prisma, workshopEntitlements }),
    },
  ],
  exports: [MEMBERSHIP_ENTITLEMENTS],
})
export class MembershipEntitlementsModule {}
