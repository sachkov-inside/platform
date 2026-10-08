import "server-only";

import {
  handleAuthenticatedRead,
  handleAuthenticatedMutation,
} from "@/shared/auth/index.server";
import { getPrivateMemberProfile } from "./get-private-member-profile";
import { executeCreateMemberProfile } from "./create-member-profile";
import { executeUpdateMemberProfile } from "./update-member-profile";

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
  return handleAuthenticatedMutation(request, executeCreateMemberProfile);
}

export function handleUpdateMemberProfileRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, executeUpdateMemberProfile);
}
