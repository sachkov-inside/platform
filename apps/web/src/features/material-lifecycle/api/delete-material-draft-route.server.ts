import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeDeleteMaterialDraft } from "./delete-material-draft";

export function handleDeleteMaterialDraftRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeDeleteMaterialDraft);
}
