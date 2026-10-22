import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  deleteMaterialDraftInputSchema,
  deleteMaterialDraftResultSchema,
} from "../model/delete-material-draft";
import {
  transitionMaterialPublicationInputSchema,
  transitionMaterialPublicationResultSchema,
} from "../model/transition-material-publication";

function lifecycleFailure(
  operation: string,
  failure: MutationTransportFailure,
) {
  if (failure.kind === "contract") {
    return {
      kind: "unexpected_error",
      reference: `${operation}-bff-contract`,
    } as const;
  }
  return failure.status === 401 || failure.status === 403
    ? ({ kind: "unauthorized" } as const)
    : ({
        kind: "infrastructure_error",
        reference: `${operation}-bff-${String(failure.status)}`,
      } as const);
}

/** Publishes or unpublishes a Material at the version the author saw. */
export const transitionMaterialPublicationOperation = defineMutationOperation({
  input: transitionMaterialPublicationInputSchema,
  method: "PATCH",
  path: "/api/authoring/materials",
  result: transitionMaterialPublicationResultSchema,
  transportFailure: (failure) =>
    lifecycleFailure("transition-material-publication", failure),
});

/** Deletes a never-published Material draft, optionally with its owned Video. */
export const deleteMaterialDraftOperation = defineMutationOperation({
  input: deleteMaterialDraftInputSchema,
  method: "DELETE",
  path: "/api/authoring/materials",
  result: deleteMaterialDraftResultSchema,
  transportFailure: (failure) =>
    lifecycleFailure("delete-material-draft", failure),
});
