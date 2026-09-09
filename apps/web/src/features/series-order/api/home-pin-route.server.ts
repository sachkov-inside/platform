import "server-only";
import { getPlatformAccessToken, handleAuthenticatedMutation, LogtoSessionUnavailableError, readLogtoBffConfig } from "@/shared/auth/index.server";
import { executeSetHomePin, getHomePin } from "./home-pin.server";

export async function handleHomePinReadRequest(): Promise<Response> {
  const headers = { "cache-control": "private, no-store" };
  try {
    const accessToken = await getPlatformAccessToken(readLogtoBffConfig());
    return Response.json(await getHomePin(accessToken), { headers });
  } catch (error) {
    return Response.json({ kind: error instanceof LogtoSessionUnavailableError ? "unauthorized" : "unavailable" }, { headers });
  }
}
export function handleHomePinWriteRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeSetHomePin);
}
