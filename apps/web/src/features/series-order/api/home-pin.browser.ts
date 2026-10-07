import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  homePinResultSchema,
  type HomePinResult,
  type SetHomePinInput,
} from "../model/home-pin";

export async function loadHomePin(signal: AbortSignal): Promise<HomePinResult> {
  const result = await requestAuthenticatedRead(
    "/api/authoring/home-pin",
    signal,
  );
  if (result.kind === "rejected") {
    const parsed = homePinResultSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : { kind: "unavailable" };
  }
  if (result.kind !== "ready")
    return {
      kind:
        result.kind === "authentication_required"
          ? "unauthorized"
          : "unavailable",
    };
  const parsed = homePinResultSchema.safeParse(result.value);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}

export async function setHomePin(
  input: SetHomePinInput,
): Promise<HomePinResult> {
  const body = new FormData();
  body.set("seriesId", input.seriesId ?? "");
  body.set("expectedVersion", String(input.expectedVersion));
  const response = await requestSameOriginMutation(
    "/api/authoring/home-pin",
    "PUT",
    body,
  );
  if (!response.ok)
    return { kind: response.status === 401 ? "unauthorized" : "unavailable" };
  const parsed = homePinResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}
