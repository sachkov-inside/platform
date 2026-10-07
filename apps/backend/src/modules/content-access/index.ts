export { assembleContentAccess } from "./facets/content-access/assemble-content-access.js";
export {
  CONTENT_ACCESS,
  PRODUCT_TASK_RESOURCE_FACTS,
} from "./content-access.token.js";
export { assembleCurrentAccountPermissions } from "./adapters/accounts/current-account-permissions.js";
export { assembleDeterministicAccountRights } from "./adapters/membership/deterministic-account-rights.js";
export type {
  AssetResourceFactsAdapter,
  ProductArtifactResourceFacts,
  ProductArtifactResourceFactsAdapter,
  ProductTaskResourceFacts,
  ProductTaskResourceFactsAdapter,
  MaterialResourceFacts,
  MaterialResourceFactsAdapter,
  MembershipAccessState,
  VideoResourceFacts,
  VideoResourceFactsAdapter,
} from "./facets/content-access/content-access.dependencies.js";
export {
  anonymousSubject,
  type AccessAvailability,
  type ContentAccess,
  type Resource,
  type Subject,
} from "./facets/content-access/content-access.interface.js";
