import type {
  MembershipAccessState,
  AccountRights,
} from "../../facets/content-access/content-access.dependencies.js";
import type { AccountId } from "../../../accounts/index.js";

export function assembleDeterministicAccountRights(
  states: ReadonlyMap<AccountId, MembershipAccessState> = new Map(),
): AccountRights {
  return Object.freeze({
    resolveForAccess(accountId: AccountId) {
      const state: MembershipAccessState = states.get(accountId) ?? {
        kind: "required",
      };
      return Promise.resolve(state);
    },
  });
}
