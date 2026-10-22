import "server-only";

import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  deleteMaterialDraftInvalidInput,
  executeDeleteMaterialDraft,
} from "./delete-material-draft";
import { deleteMaterialDraftOperation } from "./material-lifecycle.operation";

export function handleDeleteMaterialDraftRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, deleteMaterialDraftOperation, {
    execute: (input, accessToken) =>
      executeDeleteMaterialDraft(input, accessToken),
    invalidInput: deleteMaterialDraftInvalidInput,
  });
}
