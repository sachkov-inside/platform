import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { materialOpenResultSchema, type MaterialOpenCommand } from "../model/material-open-contract";
export async function recordMaterialOpen(command: MaterialOpenCommand) {
  const form = new FormData();
  form.set("materialId", command.materialId); form.set("contentVersion", String(command.contentVersion)); form.set("commandId", command.commandId);
  const result = await requestSameOriginMutation("/api/reading-progress/open", "POST", form);
  if (!result.ok) return { kind: result.status === 401 ? "unauthorized" : "unavailable" } as const;
  const parsed = materialOpenResultSchema.safeParse(result.body);
  return parsed.success ? parsed.data : { kind: "unavailable" } as const;
}
