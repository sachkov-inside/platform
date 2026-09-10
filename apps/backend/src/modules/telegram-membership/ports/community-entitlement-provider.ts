import type {
  CommunityErrorCode,
  CommunityResult,
  CommunitySetCommand,
} from "../domain/community-entitlement.js";

export type CommunityDeliveryOutcome =
  | { readonly kind: "result"; readonly result: CommunityResult }
  | { readonly kind: "error"; readonly error: CommunityErrorCode }
  /** No correlated answer: never evidence that the external effect did or did not happen. */
  | { readonly kind: "unavailable" };

export interface CommunityEntitlementProvider {
  set(command: CommunitySetCommand): Promise<CommunityDeliveryOutcome>;
  /**
   * Asks what happened to one already sent command. It takes the command itself so the
   * answer can be correlated against what was actually sent, not just its identifier.
   */
  status(command: CommunitySetCommand): Promise<CommunityDeliveryOutcome>;
}

/** Without provider configuration nothing is delivered and nothing is claimed applied. */
export const disabledCommunityEntitlementProvider: CommunityEntitlementProvider =
  Object.freeze({
    set: () => Promise.resolve({ kind: "unavailable" as const }),
    status: () => Promise.resolve({ kind: "unavailable" as const }),
  });
