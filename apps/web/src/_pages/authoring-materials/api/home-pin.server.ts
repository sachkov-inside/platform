import "server-only";
import { z } from "zod";
import { BackendConnectionError, requestAuthoringHomePin, requestHomePinUpdate, type BackendTransportResult } from "@/shared/api/backend/index.server";
import { homePinSchema, type HomePinResult } from "../model/home-pin";

const inputSchema = z.object({ materialId: z.union([z.uuid(), z.literal("")]).transform((id) => id === "" ? null : id), expectedVersion: z.coerce.number().int().positive() }).strict();

export async function getHomePin(accessToken: string): Promise<HomePinResult> {
  try { return mapResult(await requestAuthoringHomePin(accessToken)); }
  catch (error) { if (error instanceof BackendConnectionError) return { kind: "unavailable" }; throw error; }
}

export async function executeSetHomePin(form: FormData, accessToken: string): Promise<HomePinResult> {
  const parsed = inputSchema.safeParse({ materialId: form.get("materialId"), expectedVersion: form.get("expectedVersion") });
  if (!parsed.success) return { kind: "invalid_input" };
  try {
    const result = mapResult(await requestHomePinUpdate(parsed.data, accessToken));
    return result.kind === "ready" && (result.pin.materialId !== parsed.data.materialId || result.pin.version !== parsed.data.expectedVersion + 1)
      ? { kind: "unavailable" } : result;
  }
  catch (error) { if (error instanceof BackendConnectionError) return { kind: "unavailable" }; throw error; }
}

function mapResult(result: BackendTransportResult): HomePinResult {
  if (result.ok) {
    const parsed = homePinSchema.safeParse(result.body);
    return parsed.success ? { kind: "ready", pin: parsed.data } : { kind: "unavailable" };
  }
  const problem = z.object({ code: z.string() }).loose().safeParse(result.problem);
  if (result.response.status === 401) return { kind: "unauthorized" };
  if (result.response.status === 403) return { kind: "forbidden" };
  if (result.response.status === 409 && problem.success && problem.data.code === "stale_home_pin") return { kind: "conflict" };
  if ([400, 404, 422].includes(result.response.status)) return { kind: "invalid_input" };
  return { kind: "unavailable" };
}
