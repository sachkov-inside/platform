import "server-only";
import { z } from "zod";
import { requestReadingStates, requestSetReadingState } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { readingStateSchema, readingCommandSchema } from "../model/reading-contract";

export function handleReadingStates(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const ids = z.array(z.uuid()).min(1).max(100).safeParse(form.getAll("materialId"));
    if (!ids.success) return { kind: "invalid_input" };
    try {
      const result = await requestReadingStates(ids.data, token);
      if (!result.ok) return { kind: result.response.status === 401 ? "unauthorized" : "unavailable" };
      const parsed = z.array(readingStateSchema).max(100).safeParse(result.body);
      return parsed.success ? { kind: "ready", states: parsed.data } : { kind: "unavailable" };
    } catch { return { kind: "unavailable" }; }
  });
}
export function handleSetReadingState(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = readingCommandSchema.safeParse({ materialId: form.get("materialId"), commandId: form.get("commandId"), expectedVersion: Number(form.get("expectedVersion")), isRead: form.get("isRead") === "true" ? true : form.get("isRead") === "false" ? false : null });
    if (!parsed.success || form.get("expectedVersion") === null) return { kind: "invalid_input" };
    try {
      const result = await requestSetReadingState(parsed.data, token);
      if (result.ok) {
        const saved = z.object({ state: readingStateSchema, replayed: z.boolean(), changed: z.boolean() }).strict().safeParse(result.body);
        return saved.success ? { kind: "saved", state: saved.data.state, replayed: saved.data.replayed } : { kind: "unavailable" };
      }
      if (result.response.status === 409) {
        const conflict = z.object({ current: readingStateSchema.optional() }).safeParse(result.problem);
        return { kind: "conflict", current: conflict.success ? conflict.data.current ?? null : null };
      }
      return { kind: result.response.status === 401 ? "unauthorized" : result.response.status === 403 ? "denied" : "unavailable" };
    } catch { return { kind: "unavailable" }; }
  });
}
