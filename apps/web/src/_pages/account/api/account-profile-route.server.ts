import "server-only";

import {
  createMemberProfileOperation,
  updateMemberProfileOperation,
} from "@/features/member-profile-editor.operations";
import {
  handleAuthenticatedRead,
  handleMutationOperation,
} from "@/shared/auth/index.server";
import { getPrivateMemberProfile } from "./get-private-member-profile";
import {
  executeCreateMemberProfile,
  invalidCreateProfileFields,
} from "./create-member-profile";
import {
  executeUpdateMemberProfile,
  invalidUpdateProfileFields,
} from "./update-member-profile";

export async function handleAccountProfileRequest(): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const result = await getPrivateMemberProfile(accessToken);
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

export function handleCreateMemberProfileRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, createMemberProfileOperation, {
    execute: (input, accessToken) =>
      executeCreateMemberProfile(input, accessToken),
    invalidInput: invalidCreateProfileFields,
  });
}

export function handleUpdateMemberProfileRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, updateMemberProfileOperation, {
    execute: (input, accessToken) =>
      executeUpdateMemberProfile(input, accessToken),
    invalidInput: invalidUpdateProfileFields,
  });
}
