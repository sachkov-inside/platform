import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { readingResultSchema, readingStatesResultSchema, seriesProgressResultSchema, type ReadingCommand } from "../model/reading-contract";
export async function getReadingStates(materialIds: readonly string[]) {
  const form = new FormData();
  materialIds.forEach((id) => { form.append("materialId", id); });
  const result = await requestSameOriginMutation("/api/reading-progress/states", "POST", form);
  if (!result.ok) return { kind: result.status === 401 ? "unauthorized" : "unavailable" } as const;
  const parsed = readingStatesResultSchema.safeParse(result.body);
  return parsed.success ? parsed.data : { kind: "unavailable" } as const;
}
export async function setReadingState(input: ReadingCommand) {
  const form = new FormData();
  form.set("materialId", input.materialId);
  form.set("commandId", input.commandId);
  form.set("expectedVersion", String(input.expectedVersion));
  form.set("isRead", String(input.isRead));
  const result = await requestSameOriginMutation("/api/reading-progress/state", "PUT", form);
  if (!result.ok) return { kind: result.status === 401 ? "unauthorized" : "unavailable" } as const;
  const parsed = readingResultSchema.safeParse(result.body);
  return parsed.success ? parsed.data : { kind: "unavailable" } as const;
}
export async function getSeriesProgress(seriesId: string) {
  const form = new FormData();
  form.set("seriesId", seriesId);
  const result = await requestSameOriginMutation("/api/reading-progress/series", "POST", form);
  if (!result.ok) return { kind: result.status === 401 ? "unauthorized" : "unavailable" } as const;
  const parsed = seriesProgressResultSchema.safeParse(result.body);
  return parsed.success ? parsed.data : { kind: "unavailable" } as const;
}
