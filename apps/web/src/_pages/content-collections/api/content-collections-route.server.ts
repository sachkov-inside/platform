import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeCreateContentCollection } from "./create-content-collection";
import { executeSetContentCollectionArchive } from "./set-content-collection-archive";
import { executeUpdateContentCollection } from "./update-content-collection";

export function handleCreateContentCollection(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeCreateContentCollection);
}

export function handleUpdateContentCollection(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeUpdateContentCollection);
}

export function handleSetContentCollectionArchive(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeSetContentCollectionArchive);
}
