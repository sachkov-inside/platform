import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import {
  WORKSHOP_ENTITLEMENTS,
  WorkshopModule,
  type WorkshopEntitlements,
} from "../workshop/index.js";
import { assembleAccessGrants } from "./facets/access-grants/assemble-access-grants.js";
import { assembleMembershipEntitlements } from "./facets/membership-entitlements/assemble-membership-entitlements.js";
import {
  ACCESS_GRANTS,
  MEMBERSHIP_ENTITLEMENTS,
} from "./membership-entitlements.tokens.js";

@Module({
  imports: [PrismaModule, AccountsModule, WorkshopModule],
  providers: [
    {
      provide: MEMBERSHIP_ENTITLEMENTS,
      inject: [PrismaClientProvider, WORKSHOP_ENTITLEMENTS],
      useFactory: (
        prisma: PrismaClientProvider,
        workshopEntitlements: WorkshopEntitlements,
      ) => assembleMembershipEntitlements({ prisma, workshopEntitlements }),
    },
    {
      provide: ACCESS_GRANTS,
      inject: [PrismaClientProvider, ACCOUNTS],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts) =>
        assembleAccessGrants({ prisma, accounts }),
    },
  ],
  exports: [MEMBERSHIP_ENTITLEMENTS, ACCESS_GRANTS],
})
export class MembershipEntitlementsModule {}
