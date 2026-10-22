import "server-only";
import { z } from "zod";
import {
  BackendConnectionError,
  requestAuthoringHomePin,
  requestHomePinUpdate,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import {
  homePinSchema,
  type HomePinResult,
  type setHomePinInputSchema,
} from "../model/home-pin";

export async function getHomePin(accessToken: string): Promise<HomePinResult> {
  try {
    return mapResult(await requestAuthoringHomePin(accessToken));
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
}

export async function executeSetHomePin(
  input: z.output<typeof setHomePinInputSchema>,
  accessToken: string,
): Promise<HomePinResult> {
  try {
    const result = mapResult(await requestHomePinUpdate(input, accessToken));
    return result.kind === "ready" &&
      (result.pin.seriesId !== input.seriesId ||
        result.pin.version !== input.expectedVersion + 1)
      ? { kind: "unavailable" }
      : result;
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
}

function mapResult(result: BackendTransportResult): HomePinResult {
  if (result.ok) {
    const parsed = homePinSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", pin: parsed.data }
      : { kind: "unavailable" };
  }
  const problem = z
    .object({ code: z.string() })
    .loose()
    .safeParse(result.problem);
  if (result.response.status === 401) return { kind: "unauthorized" };
  if (result.response.status === 403) return { kind: "forbidden" };
  if (
    result.response.status === 409 &&
    problem.success &&
    problem.data.code === "stale_home_pin"
  )
    return { kind: "conflict" };
  if ([400, 404, 422].includes(result.response.status))
    return { kind: "invalid_input" };
  return { kind: "unavailable" };
}
