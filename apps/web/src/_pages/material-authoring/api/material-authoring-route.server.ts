import "server-only";

import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  createMaterialDraftInvalidInput,
  executeCreateMaterialDraft,
} from "./create-material-draft";
import { createMaterialDraftOperation } from "./create-material-draft.operation";
import { executeSaveMaterial, saveMaterialInvalidInput } from "./save-material";
import { saveMaterialOperation } from "./save-material.operation";

export function handleCreateMaterialRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, createMaterialDraftOperation, {
    execute: executeCreateMaterialDraft,
    invalidInput: createMaterialDraftInvalidInput,
  });
}

export function handleSaveMaterialRequest(request: Request): Promise<Response> {
  return handleMutationOperation(request, saveMaterialOperation, {
    execute: executeSaveMaterial,
    invalidInput: saveMaterialInvalidInput,
  });
}
