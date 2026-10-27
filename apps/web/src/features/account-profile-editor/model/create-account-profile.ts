import type {
  PrivateAccountProfile,
  ProfileField,
} from "@/entities/account-profile";

export interface CreateAccountProfileInput {
  readonly bio: string;
  readonly displayName: string;
}

export type CreateAccountProfileResult =
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
