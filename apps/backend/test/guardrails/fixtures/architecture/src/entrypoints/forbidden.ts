import type { Result } from "../modules/materials/result.js";
import type { MembershipEvidence } from "../modules/membership-entitlements/domain/membership-evidence.js";

export type ForbiddenCapabilityImport =
  | Result<string, Error>
  | MembershipEvidence;
