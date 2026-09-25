export { assembleWorkshop } from "./facets/workshop/assemble-workshop.js";
export { assembleWorkshopAccess } from "./facets/workshop-access/assemble-workshop-access.js";
export { assembleWorkshopEntitlements } from "./facets/workshop-entitlements/assemble-workshop-entitlements.js";
export type {
  WorkshopAccessDependencies,
  WorkshopAccessRequest,
  WorkshopResource,
  WorkshopResourceFacts,
  WorkshopSubject,
} from "./facets/workshop-access/workshop-access.interface.js";
export type {
  WorkshopEntitlements,
  WorkshopEntitlementState,
} from "./facets/workshop-entitlements/workshop-entitlements.interface.js";
export type {
  WorkshopMaterialAccess,
} from "./facets/workshop-material-access/workshop-material-access.interface.js";
export { resolveWorkshopMaterialProtection } from "./features/resolve-material-protection/resolve-material-protection.js";
export {
  WORKSHOP_ENTITLEMENTS,
  WORKSHOP_MATERIAL_ACCESS,
} from "./workshop.tokens.js";
export { WorkshopModule } from "./workshop.module.js";
