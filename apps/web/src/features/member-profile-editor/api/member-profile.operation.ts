import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import type { CreateMemberProfileResult } from "../model/create-member-profile";
import {
  createMemberProfileInputSchema,
  memberProfileResultSchema,
  updateMemberProfileInputSchema,
} from "../model/member-profile-operations";

function profileTransportFailure(
  operation: "create" | "update",
  failure: MutationTransportFailure,
): CreateMemberProfileResult {
  if (failure.kind === "status" && [401, 403].includes(failure.status))
    return { kind: "unauthorized" };
  return {
    kind: "unavailable",
    reference: `${operation}-member-profile-bff-${failure.kind === "contract" ? "contract" : String(failure.status)}`,
  };
}

/** Creates the Account's member profile. */
export const createMemberProfileOperation = defineMutationOperation({
  input: createMemberProfileInputSchema,
  method: "POST",
  path: "/api/account/profile",
  result: memberProfileResultSchema,
  transportFailure: (failure) => profileTransportFailure("create", failure),
});

/** Replaces the member profile at the version the editor started from. */
export const updateMemberProfileOperation = defineMutationOperation({
  input: updateMemberProfileInputSchema,
  method: "PUT",
  path: "/api/account/profile",
  result: memberProfileResultSchema,
  transportFailure: (failure) => profileTransportFailure("update", failure),
});
