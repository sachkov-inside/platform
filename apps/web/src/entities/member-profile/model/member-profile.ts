export interface MemberProfileFields {
  readonly bio: string | null;
  readonly displayName: string;
}

export interface MemberProfileAvatar {
  readonly avatarId: string;
}

export interface PrivateMemberProfile extends MemberProfileFields {
  readonly avatar: MemberProfileAvatar | null;
  readonly createdAt: string;
  readonly publicProfileId: string;
  readonly status: "active" | "disabled";
  readonly updatedAt: string;
  readonly version: number;
}

export interface MemberProfileProjectionData extends MemberProfileFields {
  readonly avatar: MemberProfileAvatar | null;
  readonly publicProfileId: string;
}

export type PrivateMemberProfileState =
  | { readonly kind: "missing" }
  | { readonly kind: "profile"; readonly profile: PrivateMemberProfile };

export type PrivateMemberProfileResult =
  | { readonly kind: "ready"; readonly state: PrivateMemberProfileState }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable"; readonly reference: string };

export type ProfileField = "bio" | "displayName";
