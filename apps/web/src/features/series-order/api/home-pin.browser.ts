import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { homePinResultSchema, type HomePinResult } from "../model/home-pin";
import { setHomePinOperation } from "./series-order.operation";

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

export const setHomePin = setHomePinOperation.send;
