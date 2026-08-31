import type { Result } from "../modules/materials/result.js";
import type { MembershipEvidence } from "../modules/membership-entitlements/features/accept-evidence/validate-membership-evidence.js";
import type { TelegramMembership } from "../modules/telegram-membership/facets/telegram-membership/telegram-membership.interface.js";

export type ForbiddenCapabilityImport =
  | Result<string, Error>
  | MembershipEvidence
  | TelegramMembership;
