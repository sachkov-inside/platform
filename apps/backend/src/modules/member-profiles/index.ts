export { MemberProfilesModule } from "./member-profiles.module.js";
export { assembleMemberProfiles } from "./facets/member-profiles/assemble-member-profiles.js";
export {
  moderateMemberProfile,
  type ModerateMemberProfileResult,
  type ProfileModerationAction,
} from "./features/moderate-profile/moderate-profile.js";
export type {
  CreateMemberProfileCommand,
  CreateMemberProfileError,
  MemberProfileError,
  MemberProfileFields,
  MemberProfileProjection,
  MemberProfileResult,
  MemberProfiles,
  PrivateMemberProfile,
  PrivateProfileState,
  ProfileValidationIssue,
  ReadPrivateProfileError,
  UpdateMemberProfileCommand,
  UpdateMemberProfileError,
  ViewMemberProfileResult,
} from "./facets/member-profiles/member-profiles.interface.js";
