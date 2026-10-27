import "server-only";

import {
  createAccountProfileOperation,
  updateAccountProfileOperation,
} from "@/features/account-profile-editor.operations";
import {
  handleAuthenticatedRead,
  handleMutationOperation,
} from "@/shared/auth/index.server";
import { getPrivateAccountProfile } from "./get-private-account-profile";
import {
  executeCreateAccountProfile,
  invalidCreateProfileFields,
} from "./create-account-profile";
import {
  executeUpdateAccountProfile,
  invalidUpdateProfileFields,
} from "./update-account-profile";

export async function handleAccountProfileRequest(): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const result = await getPrivateAccountProfile(accessToken);
    if (result.kind === "unauthorized") {
      return new Response(null, { status: 401 });
    }
    if (result.kind === "unavailable") {
      return new Response(null, {
        headers: {
          "x-correlation-id": result.reference,
        },
        status: 503,
      });
    }
    return Response.json({ state: result.state });
  });
}

export function handleCreateAccountProfileRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, createAccountProfileOperation, {
    execute: (input, accessToken) =>
      executeCreateAccountProfile(input, accessToken),
    invalidInput: invalidCreateProfileFields,
  });
}

export function handleUpdateAccountProfileRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, updateAccountProfileOperation, {
    execute: (input, accessToken) =>
      executeUpdateAccountProfile(input, accessToken),
    invalidInput: invalidUpdateProfileFields,
  });
}
