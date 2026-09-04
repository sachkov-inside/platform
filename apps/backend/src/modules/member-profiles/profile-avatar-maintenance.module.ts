import { Module } from "@nestjs/common";

import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  OBJECT_STORAGE,
  ObjectStorageModule,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import {
  assembleProfileAvatarMaintenance,
  PROFILE_AVATAR_MAINTENANCE,
  type ProfileAvatarMaintenance,
} from "./features/cleanup-profile-avatar-orphans/cleanup-profile-avatar-orphans.js";

@Module({
  imports: [PrismaModule, ObjectStorageModule],
  providers: [
    {
      provide: PROFILE_AVATAR_MAINTENANCE,
      inject: [PrismaClientProvider, OBJECT_STORAGE],
      useFactory: (
        prisma: PrismaClientProvider,
        objectStorage: ObjectStorage,
      ): ProfileAvatarMaintenance =>
        assembleProfileAvatarMaintenance({ objectStorage, prisma }),
    },
  ],
  exports: [PROFILE_AVATAR_MAINTENANCE],
})
export class ProfileAvatarMaintenanceModule {}
