import type {
  MemberProfileProjection,
  MemberProfileStatus,
  PrivateMemberProfile,
} from "../facets/member-profiles/member-profiles.interface.js";
import { parseProfileAvatarId } from "../domain/profile-avatar-id.js";
import { parsePublicProfileId } from "../domain/public-profile-id.js";

interface StoredMemberProfile {
  readonly publicProfileId: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly avatarId: string | null;
  readonly status: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function privateProfileProjection(
  profile: StoredMemberProfile,
): PrivateMemberProfile | null {
  const status = profileStatus(profile.status);
  const publicProfileId = parsePublicProfileId(profile.publicProfileId);
  const avatarId =
    profile.avatarId === null ? null : parseProfileAvatarId(profile.avatarId);
  return status === null || publicProfileId === undefined || avatarId === undefined
    ? null
    : {
        publicProfileId,
        avatar: avatarId === null ? null : { avatarId },
        displayName: profile.displayName,
        bio: profile.bio,
        status,
        version: profile.version,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      };
}

export function memberProfileProjection(
  profile: Pick<
    StoredMemberProfile,
    "publicProfileId" | "displayName" | "bio" | "avatarId"
  >,
): MemberProfileProjection | null {
  const publicProfileId = parsePublicProfileId(profile.publicProfileId);
  const avatarId =
    profile.avatarId === null ? null : parseProfileAvatarId(profile.avatarId);
  return publicProfileId === undefined || avatarId === undefined
    ? null
    : {
        publicProfileId,
        displayName: profile.displayName,
        bio: profile.bio,
        avatar: avatarId === null ? null : { avatarId },
      };
}

function profileStatus(value: string): MemberProfileStatus | null {
  return value === "active" || value === "disabled" ? value : null;
}
