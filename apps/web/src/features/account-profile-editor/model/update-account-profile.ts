import type {
  PrivateAccountProfile,
  ProfileField,
} from "@/entities/account-profile";

export interface UpdateAccountProfileInput {
  readonly bio: string;
  readonly displayName: string;
  readonly expectedVersion: number;
}

export type UpdateAccountProfileResult =
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
      readonly profile: PrivateAccountProfile;
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable"; readonly reference: string };
