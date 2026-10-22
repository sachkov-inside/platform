import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  createContentCollectionInputSchema,
  createContentCollectionResultSchema,
  setContentCollectionArchiveInputSchema,
  setContentCollectionArchiveResultSchema,
  updateContentCollectionInputSchema,
  updateContentCollectionResultSchema,
} from "../model/content-collections";

function collectionsFailure(failure: MutationTransportFailure) {
  if (failure.kind === "contract") {
    return { kind: "error", reference: "collections-bff-contract" } as const;
  }
  return failure.status === 401 || failure.status === 403
    ? ({ kind: "unauthorized" } as const)
    : ({
        kind: "error",
        reference: `collections-bff-${String(failure.status)}`,
      } as const);
}

/** Creates a Series or Topic. */
export const createContentCollectionOperation = defineMutationOperation({
  input: createContentCollectionInputSchema,
  method: "POST",
  path: "/api/authoring/collections",
  result: createContentCollectionResultSchema,
  transportFailure: collectionsFailure,
});

/** Saves the metadata of a Series or Topic at the version the author saw. */
export const updateContentCollectionOperation = defineMutationOperation({
  input: updateContentCollectionInputSchema,
  method: "PUT",
  path: "/api/authoring/collections/metadata",
  result: updateContentCollectionResultSchema,
  transportFailure: collectionsFailure,
});

/** Archives or restores a Series or Topic at the version the author saw. */
export const setContentCollectionArchiveOperation = defineMutationOperation({
  input: setContentCollectionArchiveInputSchema,
  method: "PUT",
  path: "/api/authoring/collections/archive",
  result: setContentCollectionArchiveResultSchema,
  transportFailure: collectionsFailure,
});
