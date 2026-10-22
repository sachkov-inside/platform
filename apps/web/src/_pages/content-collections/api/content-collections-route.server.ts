import "server-only";

import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  createContentCollectionOperation,
  setContentCollectionArchiveOperation,
  updateContentCollectionOperation,
} from "./content-collections.operation";
import { executeCreateContentCollection } from "./create-content-collection";
import { executeSetContentCollectionArchive } from "./set-content-collection-archive";
import { executeUpdateContentCollection } from "./update-content-collection";

const invalid = () => ({ kind: "invalid" }) as const;

export function handleCreateContentCollection(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, createContentCollectionOperation, {
    execute: (input, accessToken) =>
      executeCreateContentCollection(input, accessToken),
    invalidInput: invalid,
  });
}

export function handleUpdateContentCollection(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, updateContentCollectionOperation, {
    execute: (input, accessToken) =>
      executeUpdateContentCollection(input, accessToken),
    invalidInput: invalid,
  });
}

export function handleSetContentCollectionArchive(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(
    request,
    setContentCollectionArchiveOperation,
    {
      execute: (input, accessToken) =>
        executeSetContentCollectionArchive(input, accessToken),
      invalidInput: invalid,
    },
  );
}
