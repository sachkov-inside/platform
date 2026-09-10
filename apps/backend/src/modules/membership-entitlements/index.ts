export { assembleMembershipEntitlements } from "./facets/membership-entitlements/assemble-membership-entitlements.js";
export {
  ACCESS_GRANTS,
  MEMBERSHIP_ENTITLEMENTS,
} from "./membership-entitlements.tokens.js";
export { MembershipEntitlementsModule } from "./membership-entitlements.module.js";
export { membershipEvidenceSchema } from "./features/accept-evidence/validate-membership-evidence.js";
export type {
  AcceptMembershipEvidenceCommand,
  MembershipAccessState,
  MembershipEntitlements,
  MembershipEvidenceAcceptance,
  MembershipEvidenceFailureCode,
  MembershipPrincipalBinding,
  MembershipEvidenceSource,
} from "./facets/membership-entitlements/membership-entitlements.interface.js";
export { assembleAccessGrants, type AccessGrants } from "./facets/access-grants/assemble-access-grants.js";
export type { AccessCapability, GrantTerms, GrantResult } from "./domain/access-grant.js";
export type { ApplyPaidPeriodCommand } from "./features/apply-paid-period/apply-paid-period.js";
export { previewCommandSchema as previewGrantBatchCommandSchema, type PreviewGrantBatchCommand, type PreviewGrantBatchResult } from "./features/preview-grant-batch/preview-grant-batch.js";
export { applyGrantBatchCommandSchema, type ApplyGrantBatchCommand, type ApplyGrantBatchResult } from "./features/apply-grant-batch/apply-grant-batch.js";
export { changeAccessGrantCommandSchema, type ChangeAccessGrantCommand } from "./features/change-access-grant/change-access-grant.js";
export { accessGrantsViewSchema, type AccessGrantsView, type ListAccessGrantsCommand } from "./features/list-access-grants/list-access-grants.js";
export type { ClassifyLegacyAccountCommand } from "./features/classify-legacy-account/classify-legacy-account.js";

export { accessCapabilitySchema, capabilitiesSchema } from "./domain/access-grant.js";

export { paidPeriodCommandSchema } from "./features/apply-paid-period/apply-paid-period.js";
