import "server-only";

import {
  handleAuthenticatedMutation,
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";
import { getPrivateMemberProfile } from "./get-private-member-profile";
import { executeCreateMemberProfile } from "./create-member-profile";
import { executeUpdateMemberProfile } from "./update-member-profile";

export async function handleAccountProfileRequest(): Promise<Response> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return new Response(null, {
      headers: privateHeaders(),
      status: error instanceof LogtoSessionUnavailableError ? 401 : 503,
    });
  }

  const result = await getPrivateMemberProfile(accessToken);
  if (result.kind === "unauthorized") {
    return new Response(null, { headers: privateHeaders(), status: 401 });
  }
  if (result.kind === "unavailable") {
    return new Response(null, {
      headers: {
        ...privateHeaders(),
        "x-correlation-id": result.reference,
      },
      status: 503,
    });
  }
  return Response.json(
    { state: result.state },
    { headers: privateHeaders() },
  );
}

export function handleCreateMemberProfileRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeCreateMemberProfile);
}

export function handleUpdateMemberProfileRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeUpdateMemberProfile);
}

function privateHeaders(): Record<string, string> {
  return { "cache-control": "no-store, private" };
}
