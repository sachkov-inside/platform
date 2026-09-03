export { assembleWorkshop } from "./facets/workshop/assemble-workshop.js";
export { assembleWorkshopMaterialAccess } from "./facets/workshop-material-access/assemble-workshop-material-access.js";
export type {
  GrantWorkshopEntitlementCommand,
  GrantWorkshopEntitlementResult,
  LoadWorkshopCaseResult,
  PublishWorkshopCaseCommand,
  PublishedWorkshopCaseDto,
  PublishWorkshopCaseResult,
  Workshop,
  WorkshopAccessState,
  WorkshopEntitlementDto,
  WorkshopMaterialReleasePolicy,
  WorkshopMaterialRole,
  RevealWorkshopHintCommand,
  RevealWorkshopSolutionCommand,
  WorkshopRevealDto,
  WorkshopRevealResult,
} from "./facets/workshop/workshop.interface.js";
export type {
  WorkshopMaterialAccess,
  WorkshopMaterialAccessState,
} from "./facets/workshop-material-access/workshop-material-access.interface.js";
export type {
  WorkshopMaterialProtection,
  WorkshopMaterialProtectionState,
} from "./facets/workshop-material-protection/workshop-material-protection.interface.js";
export type {
  SourceArchives,
  StoredSourceArchive,
  StoreSourceArchiveResult,
} from "./ports/source-archives.js";
export {
  WORKSHOP_MATERIAL_ACCESS,
  WORKSHOP_MATERIAL_PROTECTION,
} from "./workshop.tokens.js";
export { WorkshopModule } from "./workshop.module.js";
