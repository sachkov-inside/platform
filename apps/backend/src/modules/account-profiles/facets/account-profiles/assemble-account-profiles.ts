import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import { changeProfileAvatar } from "../../features/change-profile-avatar/change-profile-avatar.js";
import { deliverProfileAvatar } from "../../features/deliver-profile-avatar/deliver-profile-avatar.js";
import { createProfile } from "../../features/create-profile/create-profile.js";
import { readPrivateProfile } from "../../features/read-private-profile/read-private-profile.js";
import { updateProfile } from "../../features/update-profile/update-profile.js";
import type { AccountProfilePersistenceClient } from "../../infrastructure/prisma.js";
import type { AccountProfiles } from "./account-profiles.interface.js";

export interface AccountProfilesDependencies {
  readonly prisma: AccountProfilePersistenceClient;
  readonly objectStorage: ObjectStorage;
  readonly signedGetTtlSeconds: number;
}

export function assembleAccountProfiles({
  prisma,
  objectStorage,
  signedGetTtlSeconds,
}: AccountProfilesDependencies): AccountProfiles {
  return {
    readPrivateProfile: (accountId) => readPrivateProfile(prisma, accountId),
    createProfile: (command) => createProfile(prisma, command),
    updateProfile: (command) => updateProfile(prisma, command),
    changeAvatar: (command) =>
      changeProfileAvatar({ objectStorage, prisma }, command),
    deliverAvatar: (input) =>
      deliverProfileAvatar(
        { objectStorage, prisma, signedGetTtlSeconds },
        input,
      ),
  };
}
