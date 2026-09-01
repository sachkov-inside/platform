import type { PrivateMemberProfile, ProfileField } from "@/entities/member-profile";

export interface UpdateMemberProfileInput {
  readonly bio: string;
  readonly displayName: string;
  readonly expectedVersion: number;
}

export type UpdateMemberProfileResult =
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
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable"; readonly reference: string };
