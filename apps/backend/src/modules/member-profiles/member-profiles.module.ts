import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { AccountsModule } from "../accounts/index.js";
import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import {
  OBJECT_STORAGE,
  ObjectStorageModule,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import { PrivateAccountProfileController } from "./adapters/nest/private-account-profile.controller.js";
import { PrivateProfileAvatarController } from "./adapters/nest/profile-avatar.controller.js";
import { assembleMemberProfiles } from "./facets/member-profiles/assemble-member-profiles.js";
import type { MemberProfiles } from "./facets/member-profiles/member-profiles.interface.js";
import { MEMBER_PROFILES } from "./member-profiles.token.js";

@Module({
  imports: [PrismaModule, AccountsModule, ObjectStorageModule],
  controllers: [PrivateAccountProfileController, PrivateProfileAvatarController],
  providers: [
    {
      provide: MEMBER_PROFILES,
      inject: [PrismaClientProvider, OBJECT_STORAGE, PLATFORM_CONFIG],
      useFactory: (
        prisma: PrismaClientProvider,
        objectStorage: ObjectStorage,
        config: PlatformConfig,
      ): MemberProfiles =>
        assembleMemberProfiles({
          prisma,
          objectStorage,
          signedGetTtlSeconds: config.objectStorage.signedGetTtlSeconds,
        }),
    },
  ],
  exports: [MEMBER_PROFILES],
})
export class MemberProfilesModule {}
