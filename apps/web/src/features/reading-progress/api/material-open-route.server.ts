import "server-only";
import { z } from "zod";
import { requestRecordMaterialOpen } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { materialOpenCommandSchema } from "../model/material-open-contract";
export function handleMaterialOpen(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    if ([...form.keys()].some((key) => !["materialId", "contentVersion", "commandId"].includes(key))) return { kind: "invalid_input" };
    const command = materialOpenCommandSchema.safeParse({ materialId: form.get("materialId"), contentVersion: Number(form.get("contentVersion")), commandId: form.get("commandId") });
    if (!command.success) return { kind: "invalid_input" };
    try {
      const response = await requestRecordMaterialOpen(command.data, token);
      if (!response.ok) return { kind: response.response.status === 401 ? "unauthorized" : response.response.status === 403 ? "denied" : response.response.status === 409 ? "conflict" : "unavailable" };
      const result = z.object({ openedAt: z.iso.datetime(), replayed: z.boolean() }).strict().safeParse(response.body);
      return result.success ? { kind: "saved", ...result.data } : { kind: "unavailable" };
    } catch { return { kind: "unavailable" }; }
  });
}
