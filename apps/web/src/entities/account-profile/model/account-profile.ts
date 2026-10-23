export interface AccountProfileFields {
  readonly bio: string | null;
  readonly displayName: string;
}

export interface AccountProfileAvatar {
  readonly avatarId: string;
}

export interface PrivateAccountProfile extends AccountProfileFields {
  readonly avatar: AccountProfileAvatar | null;
  readonly createdAt: string;
  readonly status: "active" | "disabled";
  readonly updatedAt: string;
  readonly version: number;
}

export type PrivateAccountProfileState =
  | { readonly kind: "missing" }
  | { readonly kind: "profile"; readonly profile: PrivateAccountProfile };

export type PrivateAccountProfileResult =
  | { readonly kind: "ready"; readonly state: PrivateAccountProfileState }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable"; readonly reference: string };

export type ProfileField = "bio" | "displayName";
