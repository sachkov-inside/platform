import type { PrivateMemberProfile, ProfileField } from "@/entities/member-profile";

export interface CreateMemberProfileInput {
  readonly bio: string;
  readonly displayName: string;
}

export type CreateMemberProfileResult =
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
