import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { AccountsModule } from "../accounts/index.js";
import {
  MEMBERSHIP_ENTITLEMENTS,
  MembershipEntitlementsModule,
  type MembershipEntitlements,
} from "../membership-entitlements/index.js";
import { MemberProfileController } from "./adapters/nest/member-profile.controller.js";
import { PrivateAccountProfileController } from "./adapters/nest/private-account-profile.controller.js";
import { assembleMemberProfiles } from "./facets/member-profiles/assemble-member-profiles.js";
import type { MemberProfiles } from "./facets/member-profiles/member-profiles.interface.js";
import { MEMBER_PROFILES } from "./member-profiles.token.js";

@Module({
  imports: [PrismaModule, AccountsModule, MembershipEntitlementsModule],
  controllers: [MemberProfileController, PrivateAccountProfileController],
  providers: [
    {
      provide: MEMBER_PROFILES,
      inject: [PrismaClientProvider, MEMBERSHIP_ENTITLEMENTS],
      useFactory: (
        prisma: PrismaClientProvider,
        membershipEntitlements: MembershipEntitlements,
      ): MemberProfiles =>
        assembleMemberProfiles({ prisma, membershipEntitlements }),
    },
  ],
  exports: [MEMBER_PROFILES],
})
export class MemberProfilesModule {}
