import type { AccountId } from "../../../accounts/index.js";

export type AccountProfileStatus = "active" | "disabled";

export interface AccountProfileFields {
  readonly displayName: string;
  readonly bio: string | null;
}

export interface AccountProfileAvatar {
  readonly avatarId: string;
}

/** The owner's own Profile. Nobody else sees it, so it carries no address for other members. */
export interface PrivateAccountProfile extends AccountProfileFields {
  readonly avatar: AccountProfileAvatar | null;
  readonly status: AccountProfileStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PrivateProfileState =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "profile"; profile: PrivateAccountProfile }>;

export interface ProfileValidationIssue {
  readonly field: "displayName" | "bio";
  readonly code: "required" | "too_short" | "too_long" | "invalid_characters";
}

export type AccountProfileError =
  | Readonly<{
      code: "invalid_input";
      issues: readonly ProfileValidationIssue[];
    }>
  | Readonly<{ code: "profile_exists" }>
  | Readonly<{ code: "profile_not_found" }>
  | Readonly<{ code: "conflict"; currentVersion?: number }>
  | Readonly<{ code: "internal_error"; correlationId: string }>;

export type ReadPrivateProfileError = Extract<
  AccountProfileError,
  { readonly code: "internal_error" }
>;
export type CreateAccountProfileError = Extract<
  AccountProfileError,
  { readonly code: "invalid_input" | "profile_exists" | "internal_error" }
>;
export type UpdateAccountProfileError = Extract<
  AccountProfileError,
  {
    readonly code:
      "invalid_input" | "profile_not_found" | "conflict" | "internal_error";
  }
>;
export type AccountProfileResult<Value, Error extends AccountProfileError> =
  Readonly<{ ok: true; value: Value }> | Readonly<{ ok: false; error: Error }>;

export interface CreateAccountProfileCommand extends AccountProfileFields {
  readonly accountId: AccountId;
}

export interface UpdateAccountProfileCommand extends AccountProfileFields {
  readonly accountId: AccountId;
  readonly expectedVersion: number;
}

export interface ProfileAvatarCrop {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
}

export type ChangeProfileAvatarCommand =
  | Readonly<{
      accountId: AccountId;
      body: Uint8Array;
      crop: ProfileAvatarCrop;
      declaredContentType: string;
      declaredSize: number;
      expectedChecksumSha256: string;
      expectedVersion: number;
      kind: "upload";
    }>
  | Readonly<{
      accountId: AccountId;
      expectedVersion: number;
      kind: "remove";
    }>;

export type ProfileAvatarInvalidReason =
  | "checksum_mismatch"
  | "crop_out_of_bounds"
  | "image_decode_failed"
  | "image_too_large"
  | "mime_mismatch"
  | "polyglot_image"
  | "size_mismatch"
  | "unsupported_image_type";

export type ChangeProfileAvatarResult =
  | Readonly<{ ok: true; profile: PrivateAccountProfile }>
  | Readonly<{
      ok: false;
      error:
        | Readonly<{ code: "profile_not_found" }>
        | Readonly<{ code: "conflict"; currentVersion?: number }>
        | Readonly<{
            code: "invalid_avatar";
            reason: ProfileAvatarInvalidReason;
          }>
        | Readonly<{ code: "dependency_unavailable" }>;
    }>;

export type DeliverProfileAvatarResult =
  | Readonly<{ ok: true; location: string }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: "not_found" | "dependency_unavailable" }>;
    }>;

export interface AccountProfiles {
  readPrivateProfile(
    accountId: AccountId,
  ): Promise<
    AccountProfileResult<PrivateProfileState, ReadPrivateProfileError>
  >;
  createProfile(
    command: CreateAccountProfileCommand,
  ): Promise<
    AccountProfileResult<PrivateAccountProfile, CreateAccountProfileError>
  >;
  updateProfile(
    command: UpdateAccountProfileCommand,
  ): Promise<
    AccountProfileResult<PrivateAccountProfile, UpdateAccountProfileError>
  >;
  changeAvatar(
    command: ChangeProfileAvatarCommand,
  ): Promise<ChangeProfileAvatarResult>;
  /** The owner's current avatar rendition; another Account's avatar is never delivered. */
  deliverAvatar(input: {
    readonly accountId: AccountId;
    readonly avatarId: string;
    readonly size: 160 | 320 | 640;
  }): Promise<DeliverProfileAvatarResult>;
}
