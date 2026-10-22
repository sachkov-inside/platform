import "server-only";

import { handleMutationOperation } from "@/shared/auth/index.server";

import { transitionMaterialPublicationOperation } from "./material-lifecycle.operation";
import {
  executeTransitionMaterialPublication,
  transitionMaterialPublicationInvalidInput,
} from "./transition-material-publication";

export function handleTransitionMaterialPublicationRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(
    request,
    transitionMaterialPublicationOperation,
    {
      execute: (input, accessToken) =>
        executeTransitionMaterialPublication(input, accessToken),
      invalidInput: transitionMaterialPublicationInvalidInput,
    },
  );
}
