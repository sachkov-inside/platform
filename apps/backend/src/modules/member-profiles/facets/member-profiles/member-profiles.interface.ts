import type { AccountId } from "../../../accounts/index.js";

export type MemberProfileStatus = "active" | "disabled";

export interface MemberProfileFields {
  readonly displayName: string;
  readonly bio: string | null;
}

export interface PrivateMemberProfile extends MemberProfileFields {
  readonly publicProfileId: string;
  readonly status: MemberProfileStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemberProfileProjection extends MemberProfileFields {
  readonly publicProfileId: string;
}

export type PrivateProfileState =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "profile"; profile: PrivateMemberProfile }>;

export interface ProfileValidationIssue {
  readonly field: "displayName" | "bio";
  readonly code: "required" | "too_short" | "too_long" | "invalid_characters";
}

export type MemberProfileError =
  | Readonly<{ code: "invalid_input"; issues: readonly ProfileValidationIssue[] }>
  | Readonly<{ code: "profile_exists" }>
  | Readonly<{ code: "profile_not_found" }>
  | Readonly<{ code: "conflict"; currentVersion?: number }>
  | Readonly<{ code: "internal_error"; correlationId: string }>;

export type ReadPrivateProfileError = Extract<
  MemberProfileError,
  { readonly code: "internal_error" }
>;
export type CreateMemberProfileError = Extract<
  MemberProfileError,
  { readonly code: "invalid_input" | "profile_exists" | "internal_error" }
>;
export type UpdateMemberProfileError = Extract<
  MemberProfileError,
  {
    readonly code:
      | "invalid_input"
      | "profile_not_found"
      | "conflict"
      | "internal_error";
  }
>;
export type MemberProfileResult<Value, Error extends MemberProfileError> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: Error }>;

export interface CreateMemberProfileCommand extends MemberProfileFields {
  readonly accountId: AccountId;
}

export interface UpdateMemberProfileCommand extends MemberProfileFields {
  readonly accountId: AccountId;
  readonly expectedVersion: number;
}

export type ViewMemberProfileResult =
  | Readonly<{ ok: true; profile: MemberProfileProjection }>
  | Readonly<{
      ok: false;
      error:
        | Readonly<{ code: "not_found" }>
        | Readonly<{ code: "internal_error"; correlationId: string }>;
    }>;

export interface MemberProfiles {
  readPrivateProfile(
    accountId: AccountId,
  ): Promise<MemberProfileResult<PrivateProfileState, ReadPrivateProfileError>>;
  createProfile(
    command: CreateMemberProfileCommand,
  ): Promise<MemberProfileResult<PrivateMemberProfile, CreateMemberProfileError>>;
  updateProfile(
    command: UpdateMemberProfileCommand,
  ): Promise<MemberProfileResult<PrivateMemberProfile, UpdateMemberProfileError>>;
  viewProfile(
    viewerAccountId: AccountId,
    publicProfileId: string,
  ): Promise<ViewMemberProfileResult>;
}
