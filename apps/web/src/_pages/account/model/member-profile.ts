export interface MemberProfileFields {
  readonly bio: string | null;
  readonly displayName: string;
}

export interface PrivateMemberProfile extends MemberProfileFields {
  readonly createdAt: string;
  readonly publicProfileId: string;
  readonly status: "active" | "disabled";
  readonly updatedAt: string;
  readonly version: number;
}

export interface MemberProfileProjection extends MemberProfileFields {
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

export type ProfileMutationState =
  | { readonly kind: "idle" }
  | {
      readonly fieldErrors: Partial<Readonly<Record<ProfileField, string>>>;
      readonly kind: "invalid_input";
    }
  | {
      readonly currentVersion?: number;
      readonly kind: "conflict";
    }
  | {
      readonly kind: "saved";
      readonly profile: PrivateMemberProfile;
    }
  | { readonly kind: "deleted" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const initialProfileMutationState: ProfileMutationState = { kind: "idle" };

export type ProfileReportState =
  | { readonly kind: "idle" }
  | { readonly kind: "reported"; readonly duplicate: boolean }
  | { readonly kind: "unavailable" };

export const initialProfileReportState: ProfileReportState = { kind: "idle" };
