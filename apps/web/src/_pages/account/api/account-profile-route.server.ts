import "server-only";

import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { getPrivateMemberProfile } from "./get-private-member-profile";

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
  return Response.json(result.state, { headers: privateHeaders() });
}

function privateHeaders(): Record<string, string> {
  return { "cache-control": "no-store, private" };
}
