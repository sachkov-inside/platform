export { assembleAccountRights } from "./facets/account-rights/assemble-account-rights.js";
export { ACCESS_GRANTS, ACCOUNT_RIGHTS } from "./account-rights.tokens.js";
export { AccountRightsModule } from "./account-rights.module.js";
export {
  COVERAGE_CATALOG,
  COVERAGE_CATALOG_ENTRY_LIMIT,
  COVERAGE_CATALOG_SCOPE_LIMIT,
  type CoverageCatalog,
} from "./ports/coverage-catalog.js";
export {
  RECIPIENT_LINKS,
  type RecipientLinks,
} from "./ports/recipient-links.js";
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
export { ownAccessGroundSchema } from "./features/read-own-access/read-own-access.js";
export { ownProductSchema } from "./features/read-own-products/read-own-products.js";

export {
  accessCapabilitySchema,
  capabilitiesSchema,
} from "./domain/access-grant.js";

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
} from "./domain/course-activation.js";

export { courseSourceRef } from "./domain/source-identity.js";

export {
  registerSourceSchema,
  sourceEntitlementViewSchema,
} from "./domain/course-activation.js";

export { ownSubscriptionAccessQuerySchema } from "./domain/course-activation.js";
export {
  bindingLookupQuerySchema,
  bindingSnapshotSchema,
} from "./domain/course-activation.js";

export { announcementQuerySchema } from "./domain/activation-announcement.js";

export type {
  IssueProductAccessCommand,
  ProductAccessContext,
} from "./domain/product-access.js";
export {
  issueProductAccessSchema,
  productAccessViewSchema,
  productAccessChangeSchema,
  productAccessTargetSchema,
  productAccessListQuerySchema,
  productAccessListSchema,
  productAccessRecordsSchema,
} from "./domain/product-access.js";
