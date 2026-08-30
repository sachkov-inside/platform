import type { MembershipEntitlements } from "../../../membership-entitlements/index.js";
import { createProfile } from "../../features/create-profile/create-profile.js";
import { deleteProfile } from "../../features/delete-profile/delete-profile.js";
import { readPrivateProfile } from "../../features/read-private-profile/read-private-profile.js";
import { reportProfile } from "../../features/report-profile/report-profile.js";
import { updateProfile } from "../../features/update-profile/update-profile.js";
import { viewMemberProfile } from "../../features/view-member-profile/view-member-profile.js";
import type { MemberProfilePersistenceClient } from "../../infrastructure/prisma.js";
import type { MemberProfiles } from "./member-profiles.interface.js";

export interface MemberProfilesDependencies {
  readonly prisma: MemberProfilePersistenceClient;
  readonly membershipEntitlements: Pick<
    MembershipEntitlements,
    "resolveForAccess"
  >;
}

export function assembleMemberProfiles({
  prisma,
  membershipEntitlements,
}: MemberProfilesDependencies): MemberProfiles {
  return {
    readPrivateProfile: (accountId) => readPrivateProfile(prisma, accountId),
    createProfile: (command) => createProfile(prisma, command),
    updateProfile: (command) => updateProfile(prisma, command),
    deleteProfile: (command) => deleteProfile(prisma, command),
    viewProfile: (viewerAccountId, publicProfileId) =>
      viewMemberProfile(
        prisma,
        membershipEntitlements,
        viewerAccountId,
        publicProfileId,
      ),
    reportProfile: (viewerAccountId, publicProfileId, reason) =>
      reportProfile(
        prisma,
        membershipEntitlements,
        viewerAccountId,
        publicProfileId,
        reason,
      ),
  };
}
