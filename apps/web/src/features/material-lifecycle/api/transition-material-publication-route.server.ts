import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeTransitionMaterialPublication } from "./transition-material-publication";

export function handleTransitionMaterialPublicationRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, executeTransitionMaterialPublication);
}
