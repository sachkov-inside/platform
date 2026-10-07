import "server-only";
import {
  handleAuthenticatedRead,
  handleAuthenticatedMutation,
} from "@/shared/auth/index.server";
import { executeSetHomePin, getHomePin } from "./home-pin.server";

export async function handleHomePinReadRequest(): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    return Response.json(await getHomePin(accessToken));
  });
}
export function handleHomePinWriteRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeSetHomePin);
}
