import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeContentCollectionMutation } from "./mutate-content-collection";

export function handleContentCollectionMutation(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeContentCollectionMutation);
}
