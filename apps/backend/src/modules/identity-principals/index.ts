export { assembleIdentityPrincipals } from "./facets/identity-principals/assemble-identity-principals.js";
export {
  type BeginReauthenticationResult,
  type CompleteReauthenticationResult,
  type EndSessionResult,
  type HumanSessionEstablishmentResult,
  type ServiceSessionEstablishmentResult,
  type IdentityPrincipals,
  type PermissionDecision,
  type PlatformPermission,
  type ResolveSubjectResult,
  type TrustedSubject,
} from "./facets/identity-principals/identity-principals.interface.js";
export {
  IdentityPrincipalsModule,
} from "./identity-principals.module.js";
