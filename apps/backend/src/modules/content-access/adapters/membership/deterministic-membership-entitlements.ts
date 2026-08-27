import type {
  MembershipAccessState,
  MembershipEntitlements,
} from "../../facets/content-access/content-access.dependencies.js";
import type { AccountId } from "../../../accounts/index.js";

export function assembleDeterministicMembershipEntitlements(
  states: ReadonlyMap<AccountId, MembershipAccessState> = new Map(),
): MembershipEntitlements {
  return Object.freeze({
    resolveForAccess(accountId: AccountId) {
      const state: MembershipAccessState =
        states.get(accountId) ?? { kind: "required" };
      return Promise.resolve(state);
    },
  });
}
