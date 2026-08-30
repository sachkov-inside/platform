import type {
  MemberProfileProjection,
  MemberProfileStatus,
  PrivateMemberProfile,
} from "../facets/member-profiles/member-profiles.interface.js";

interface StoredMemberProfile {
  readonly publicProfileId: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly status: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function privateProfileProjection(
  profile: StoredMemberProfile,
): PrivateMemberProfile | null {
  const status = profileStatus(profile.status);
  return status === null
    ? null
    : {
        publicProfileId: profile.publicProfileId,
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
    "publicProfileId" | "displayName" | "bio"
  >,
): MemberProfileProjection {
  return {
    publicProfileId: profile.publicProfileId,
    displayName: profile.displayName,
    bio: profile.bio,
  };
}

function profileStatus(value: string): MemberProfileStatus | null {
  return value === "active" || value === "disabled" ? value : null;
}
