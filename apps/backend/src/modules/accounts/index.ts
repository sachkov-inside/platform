export { AccountsModule } from "./accounts.module.js";
export { assembleAccounts } from "./facets/accounts/assemble-accounts.js";
export {
  bootstrapOwnerAccount,
  type OwnerBootstrapResult,
} from "./features/bootstrap-owner-account/bootstrap-owner-account.js";
export {
  type Accounts,
  type AuthenticatedAccount,
  type EstablishAccountResult,
  type PermissionDecision,
  type PlatformPermission,
  type ResolveAccountResult,
} from "./facets/accounts/accounts.interface.js";
