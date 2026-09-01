export { assembleContentAccess } from "./facets/content-access/assemble-content-access.js";
export { CONTENT_ACCESS } from "./content-access.token.js";
export { assembleCurrentAccountPermissions } from "./adapters/accounts/current-account-permissions.js";
export { assembleDeterministicMembershipEntitlements } from "./adapters/membership/deterministic-membership-entitlements.js";
export type {
  AccountPermissions,
  AssetResourceFacts,
  AssetResourceFactsAdapter,
  ContentAccessDependencies,
  MaterialResourceFacts,
  MaterialResourceFactsAdapter,
  MembershipAccessState,
  MembershipEntitlements,
} from "./facets/content-access/content-access.dependencies.js";
export {
  anonymousSubject,
  type AccessAction,
  type AccessAvailability,
  type AccessBatchRequest,
  type AccessDecision,
  type AccessOperation,
  type AccessRequest,
  type AvailabilityBatchResult,
  type ContentAccess,
  type DenyReason,
  type EnforcementPoint,
  type MaterialResource,
  type Resource,
  type Subject,
} from "./facets/content-access/content-access.interface.js";
