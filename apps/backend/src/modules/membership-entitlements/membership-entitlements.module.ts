import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { assembleMembershipEntitlements } from "./facets/membership-entitlements/assemble-membership-entitlements.js";
import { MEMBERSHIP_ENTITLEMENTS } from "./membership-entitlements.token.js";

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: MEMBERSHIP_ENTITLEMENTS,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        assembleMembershipEntitlements({ prisma }),
    },
  ],
  exports: [MEMBERSHIP_ENTITLEMENTS],
})
export class MembershipEntitlementsModule {}
