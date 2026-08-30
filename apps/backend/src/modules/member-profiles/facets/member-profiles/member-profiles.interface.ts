import type { AccountId } from "../../../accounts/index.js";

export type MemberProfileStatus = "active" | "disabled";
export type MemberProfileReportReason =
  | "unsafe_content"
  | "impersonation"
  | "other";

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

export type MemberProfileResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: MemberProfileError }>;

export interface CreateMemberProfileCommand extends MemberProfileFields {
  readonly accountId: AccountId;
}

export interface UpdateMemberProfileCommand extends MemberProfileFields {
  readonly accountId: AccountId;
  readonly expectedVersion: number;
}

export interface DeleteMemberProfileCommand {
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

export type ReportMemberProfileResult =
  | Readonly<{ ok: true; outcome: "recorded" | "already_recorded" }>
  | Readonly<{
      ok: false;
      error:
        | Readonly<{ code: "not_found" }>
        | Readonly<{ code: "internal_error"; correlationId: string }>;
    }>;

export interface MemberProfiles {
  readPrivateProfile(accountId: AccountId): Promise<MemberProfileResult<PrivateProfileState>>;
  createProfile(
    command: CreateMemberProfileCommand,
  ): Promise<MemberProfileResult<PrivateMemberProfile>>;
  updateProfile(
    command: UpdateMemberProfileCommand,
  ): Promise<MemberProfileResult<PrivateMemberProfile>>;
  deleteProfile(
    command: DeleteMemberProfileCommand,
  ): Promise<MemberProfileResult<Readonly<{ deleted: true }>>>;
  viewProfile(
    viewerAccountId: AccountId,
    publicProfileId: string,
  ): Promise<ViewMemberProfileResult>;
  reportProfile(
    viewerAccountId: AccountId,
    publicProfileId: string,
    reason: MemberProfileReportReason,
  ): Promise<ReportMemberProfileResult>;
}
