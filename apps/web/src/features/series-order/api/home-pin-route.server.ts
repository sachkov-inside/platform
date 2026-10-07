import "server-only";
import {
  handleAuthenticatedRead,
  handleAuthenticatedMutation,
} from "@/shared/auth/index.server";
import { executeSetHomePin, getHomePin } from "./home-pin.server";

export async function handleHomePinReadRequest(): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const result = await getHomePin(accessToken);
    return Response.json(result, {
      status:
        result.kind === "unauthorized"
          ? 401
          : result.kind === "unavailable"
            ? 503
            : result.kind === "forbidden"
              ? 403
              : result.kind === "conflict"
                ? 409
                : result.kind === "invalid_input"
                  ? 400
                  : 200,
    });
  });
}
export function handleHomePinWriteRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeSetHomePin);
}
