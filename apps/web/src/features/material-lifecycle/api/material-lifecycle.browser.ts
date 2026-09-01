import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type { MaterialLifecycleActionState } from "../model/material-lifecycle-state";

const issueSchema = z.object({ code: z.string(), path: z.string() }).strict();
const lifecycleStateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      contentVersion: z.number().int().positive(),
      kind: z.literal("saved"),
      nextSubmissionId: z.uuid(),
      publicationState: z.enum(["published", "unpublished"]),
    })
    .strict(),
  z.object({ kind: z.literal("deleted"), materialId: z.uuid() }).strict(),
  z.object({ kind: z.literal("invalid_input"), issues: z.array(issueSchema) }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("not_found") }).strict(),
  z
    .object({
      currentContentVersion: z.number().int().positive().optional(),
      kind: z.literal("conflict"),
      reason: z.enum([
        "draft_deletion_forbidden",
        "idempotency_key_reused",
        "invalid_publication_transition",
        "stale_content_version",
      ]),
    })
    .strict(),
  z.object({ kind: z.literal("infrastructure_error"), reference: z.string() }).strict(),
  z.object({ kind: z.literal("unexpected_error"), reference: z.string() }).strict(),
]);

export async function mutateMaterialLifecycle(
  formData: FormData,
): Promise<MaterialLifecycleActionState> {
  const method = formData.get("operation") === "delete" ? "DELETE" : "PATCH";
  const result = await requestSameOriginMutation(
    "/api/authoring/materials",
    method,
    formData,
  );
  if (!result.ok) {
    return result.status === 401 || result.status === 403
      ? { kind: "unauthorized" }
      : { kind: "infrastructure_error", reference: `material-lifecycle-bff-${String(result.status)}` };
  }
  const parsed = lifecycleStateSchema.safeParse(result.body);
  if (!parsed.success) {
    return { kind: "unexpected_error", reference: "material-lifecycle-bff-contract" };
  }
  if (parsed.data.kind === "conflict") {
    return parsed.data.currentContentVersion === undefined
      ? { kind: "conflict", reason: parsed.data.reason }
      : {
          currentContentVersion: parsed.data.currentContentVersion,
          kind: "conflict",
          reason: parsed.data.reason,
        };
  }
  return parsed.data;
}
