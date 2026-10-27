import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import type { CreateAccountProfileResult } from "../model/create-account-profile";
import {
  createAccountProfileInputSchema,
  accountProfileResultSchema,
  updateAccountProfileInputSchema,
} from "../model/account-profile-operations";

function profileTransportFailure(
  operation: "create" | "update",
  failure: MutationTransportFailure,
): CreateAccountProfileResult {
  if (failure.kind === "status" && [401, 403].includes(failure.status))
    return { kind: "unauthorized" };
  return {
    kind: "unavailable",
    reference: `${operation}-account-profile-bff-${failure.kind === "contract" ? "contract" : String(failure.status)}`,
  };
}

/** Creates the Account's member profile. */
export const createAccountProfileOperation = defineMutationOperation({
  input: createAccountProfileInputSchema,
  method: "POST",
  path: "/api/account/profile",
  result: accountProfileResultSchema,
  transportFailure: (failure) => profileTransportFailure("create", failure),
});

/** Replaces the member profile at the version the editor started from. */
export const updateAccountProfileOperation = defineMutationOperation({
  input: updateAccountProfileInputSchema,
  method: "PUT",
  path: "/api/account/profile",
  result: accountProfileResultSchema,
  transportFailure: (failure) => profileTransportFailure("update", failure),
});
