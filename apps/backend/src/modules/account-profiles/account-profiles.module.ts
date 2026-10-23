import { AccountNames } from "./facets/account-names/account-names.js";
import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { AccountsModule } from "../accounts/index.js";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  OBJECT_STORAGE,
  ObjectStorageModule,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import { PrivateAccountProfileController } from "./adapters/nest/private-account-profile.controller.js";
import { PrivateProfileAvatarController } from "./adapters/nest/profile-avatar.controller.js";
import { assembleAccountProfiles } from "./facets/account-profiles/assemble-account-profiles.js";
import type { AccountProfiles } from "./facets/account-profiles/account-profiles.interface.js";
import { ACCOUNT_PROFILES } from "./account-profiles.token.js";

@Module({
  imports: [PrismaModule, AccountsModule, ObjectStorageModule],
  controllers: [
    PrivateAccountProfileController,
    PrivateProfileAvatarController,
  ],
  providers: [
    {
      provide: AccountNames,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) => new AccountNames(prisma),
    },
    {
      provide: ACCOUNT_PROFILES,
      inject: [PrismaClientProvider, OBJECT_STORAGE, PLATFORM_CONFIG],
      useFactory: (
        prisma: PrismaClientProvider,
        objectStorage: ObjectStorage,
        config: PlatformConfig,
      ): AccountProfiles =>
        assembleAccountProfiles({
          prisma,
          objectStorage,
          signedGetTtlSeconds: config.objectStorage.signedGetTtlSeconds,
        }),
    },
  ],
  exports: [ACCOUNT_PROFILES, AccountNames],
})
export class AccountProfilesModule {}
