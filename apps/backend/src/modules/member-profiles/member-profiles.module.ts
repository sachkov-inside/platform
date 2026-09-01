import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { AccountsModule } from "../accounts/index.js";
import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import { AssetsModule, OBJECT_STORAGE } from "../assets/index.js";
import type { ObjectStorage } from "../../infrastructure/object-storage/index.js";
import {
  MEMBERSHIP_ENTITLEMENTS,
  MembershipEntitlementsModule,
  type MembershipEntitlements,
} from "../membership-entitlements/index.js";
import { MemberProfileController } from "./adapters/nest/member-profile.controller.js";
import { PrivateAccountProfileController } from "./adapters/nest/private-account-profile.controller.js";
import { PrivateProfileAvatarController, ProfileAvatarDeliveryController } from "./adapters/nest/profile-avatar.controller.js";
import { assembleMemberProfiles } from "./facets/member-profiles/assemble-member-profiles.js";
import type { MemberProfiles } from "./facets/member-profiles/member-profiles.interface.js";
import { MEMBER_PROFILES } from "./member-profiles.token.js";

@Module({
  imports: [PrismaModule, AccountsModule, MembershipEntitlementsModule, AssetsModule],
  controllers: [
    MemberProfileController,
    PrivateAccountProfileController,
    PrivateProfileAvatarController,
    ProfileAvatarDeliveryController,
  ],
  providers: [
    {
      provide: MEMBER_PROFILES,
      inject: [PrismaClientProvider, MEMBERSHIP_ENTITLEMENTS, OBJECT_STORAGE, PLATFORM_CONFIG],
      useFactory: (
        prisma: PrismaClientProvider,
        membershipEntitlements: MembershipEntitlements,
        objectStorage: ObjectStorage,
        config: PlatformConfig,
      ): MemberProfiles =>
        assembleMemberProfiles({
          prisma,
          membershipEntitlements,
          objectStorage,
          signedGetTtlSeconds: config.objectStorage.signedGetTtlSeconds,
        }),
    },
  ],
  exports: [MEMBER_PROFILES],
})
export class MemberProfilesModule {}
