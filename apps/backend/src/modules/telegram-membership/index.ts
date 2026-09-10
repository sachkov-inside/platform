export { assembleTelegramMembership } from "./facets/telegram-membership/assemble-telegram-membership.js";
export { TelegramMembershipModule } from "./telegram-membership.module.js";
export type {
  AcceptTelegramEvidenceCommand,
  AccountMembershipState,
  AccountTelegramLinkState,
  AccountTelegramMembershipPresentation,
  AccountTelegramMembershipResult,
  TelegramLinkResult,
  TelegramLinkState,
  TelegramLinkStatus,
  TelegramMembership,
} from "./facets/telegram-membership/telegram-membership.interface.js";
export { TelegramAccountLinks, type TelegramAccountLinkResult } from "./facets/telegram-account-links/telegram-account-links.js";
export { TelegramAccountLinksModule } from "./telegram-account-links.module.js";
export { CommunityEntitlements } from "./facets/community-entitlements/community-entitlements.js";
export type {
  CommunityEntitlementsDependencies,
  CommunitySweepReport,
} from "./facets/community-entitlements/community-entitlements.js";
export {
  communityDeliveryViewSchema,
  type CommunityDeliveryView,
} from "./facets/community-entitlements/community-delivery.contract.js";
export { CommunityEntitlementsModule } from "./community-entitlements.module.js";
export {
  COMMUNITY_RECONCILIATION_INTERVAL_MS,
  type CommunityAccess,
  type CommunitySetCommand,
  type DispatchAuthorizeRequest,
} from "./domain/community-entitlement.js";
export type {
  CommunityDeliveryOutcome,
  CommunityEntitlementProvider,
} from "./ports/community-entitlement-provider.js";
