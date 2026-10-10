export { assembleAccountRights } from "./facets/account-rights/assemble-account-rights.js";
export { ACCESS_GRANTS, ACCOUNT_RIGHTS } from "./account-rights.tokens.js";
export { AccountRightsModule } from "./account-rights.module.js";
export {
  COVERAGE_CATALOG,
  type CoverageCatalog,
} from "./ports/coverage-catalog.js";
export {
  RECIPIENT_LINKS,
  type RecipientLinks,
} from "./ports/recipient-links.js";
export { membershipEvidenceSchema } from "./features/accept-evidence/validate-membership-evidence.js";
export type {
  AccountRights,
  MembershipEvidenceAcceptance,
  MembershipEvidenceSource,
} from "./facets/account-rights/account-rights.interface.js";
export {
  assembleAccessGrants,
  type AccessGrants,
} from "./facets/access-grants/assemble-access-grants.js";
export type { AccessCapability } from "./domain/access-grant.js";
export {
  previewCommandSchema as previewGrantBatchCommandSchema,
  previewOutcomeRowSchema as grantPreviewRowSchema,
} from "./features/preview-grant-batch/preview-grant-batch.js";
export { applyGrantBatchCommandSchema } from "./features/apply-grant-batch/apply-grant-batch.js";
export { changeAccessGrantCommandSchema } from "./features/change-access-grant/change-access-grant.js";
export { accessGrantsViewSchema } from "./features/list-access-grants/list-access-grants.js";
export { ownAccessGroundSchema } from "./features/read-own-access/read-own-access.js";
export type { EnrollmentEnding } from "./features/read-enrollment-endings/read-enrollment-endings.js";
export { classifyLegacyAccountCommandSchema } from "./features/classify-legacy-account/classify-legacy-account.js";

export {
  accessCapabilitySchema,
  capabilitiesSchema,
  legacyClassificationViewSchema,
  recurringAllowedFor,
} from "./domain/access-grant.js";

export { paidPeriodCommandSchema } from "./features/apply-paid-period/apply-paid-period.js";

export {
  assignEnrollmentSchema,
  changeEnrollmentSchema,
  enrollmentViewSchema,
  tierSnapshotSchema,
} from "./domain/tariff-assignment.js";

export {
  previewEnrollmentExpansionSchema,
  applyEnrollmentExpansionSchema,
  expansionPreviewSchema,
} from "./domain/tariff-assignment.js";

export {
  ACTIVATION_CONTRACT_VERSION,
  activationRuleSchema,
  manageActivationRuleSchema,
  beginActivationSchema,
  activationEvidenceSchema,
  activationOutcomeSchema,
  type ActivationBindings,
} from "./domain/subscription-activation.js";

export { courseSourceRef } from "./domain/source-identity.js";

export {
  registerSourceSchema,
  sourceEntitlementViewSchema,
} from "./domain/subscription-activation.js";

export { ownSubscriptionAccessQuerySchema } from "./domain/subscription-activation.js";
export {
  bindingLookupQuerySchema,
  bindingSnapshotSchema,
} from "./domain/subscription-activation.js";

export { TributeSources } from "./facets/tribute-sources/tribute-sources.js";
export {
  saveTributePolicySchema,
  previewTributeImportSchema,
  applyTributeImportSchema,
  reconcileTributeSchema,
  retryTributeInboxSchema,
  tributePolicySchema,
  tributePreviewSchema,
  tributeApplyResultSchema,
  tributeSourceViewSchema,
  tributeInboxViewSchema,
  tributeOperationsViewSchema,
} from "./domain/tribute-source.js";

export { tributeWebhookSchema } from "./domain/tribute-webhook.js";

export {
  tributeImportReviewSchema,
  dismissTributeImportSchema,
} from "./domain/tribute-source.js";

export {
  invitationRedemptionOutcomeSchema,
  type InvitationRedemptionOutcome,
  invitationViewSchema,
  issueInvitationSchema,
  listInvitationsSchema,
  redeemInvitationSchema,
  revokeInvitationSchema,
  type InvitationOffer,
} from "./domain/invitation.js";
export {
  accessHolderSchema,
  accessSourceSchema,
  invitationFunnelSchema,
  listAccessHoldersSchema,
  ENDING_SOON_WINDOW_MS,
  type AccessGround,
  type AccessSource,
} from "./domain/access-roster.js";
