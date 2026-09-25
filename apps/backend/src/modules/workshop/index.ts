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
  WorkshopMaterialAccessState,
} from "./facets/workshop-material-access/workshop-material-access.interface.js";
export type { WorkshopMaterialProtection } from "./facets/workshop-material-protection/workshop-material-protection.interface.js";
export {
  WORKSHOP_ENTITLEMENTS,
  WORKSHOP_MATERIAL_ACCESS,
  WORKSHOP_MATERIAL_PROTECTION,
} from "./workshop.tokens.js";
export { WorkshopModule } from "./workshop.module.js";
