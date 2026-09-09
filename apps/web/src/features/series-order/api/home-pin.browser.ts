import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { homePinResultSchema, type HomePinResult, type SetHomePinInput } from "../model/home-pin";

export async function loadHomePin(signal: AbortSignal): Promise<HomePinResult> {
  const response = await fetch("/api/authoring/home-pin", { cache: "no-store", headers: { accept: "application/json" }, signal });
  if (!response.ok) return { kind: "unavailable" };
  const parsed = homePinResultSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : { kind: "unavailable" };
}

export async function setHomePin(input: SetHomePinInput): Promise<HomePinResult> {
  const body = new FormData();
  body.set("seriesId", input.seriesId ?? "");
  body.set("expectedVersion", String(input.expectedVersion));
  const response = await requestSameOriginMutation("/api/authoring/home-pin", "PUT", body);
  if (!response.ok) return { kind: response.status === 401 ? "unauthorized" : "unavailable" };
  const parsed = homePinResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}
