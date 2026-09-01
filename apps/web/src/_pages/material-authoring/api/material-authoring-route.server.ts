import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeCreateMaterialDraft } from "./create-material-draft";
import { executeSaveMaterial } from "./save-material";

export function handleCreateMaterialRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeCreateMaterialDraft);
}

export function handleSaveMaterialRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeSaveMaterial);
}
