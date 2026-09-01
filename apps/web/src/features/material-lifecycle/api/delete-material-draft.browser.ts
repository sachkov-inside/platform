import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type {
  DeleteMaterialDraftInput,
  DeleteMaterialDraftResult,
} from "../model/delete-material-draft";

const issueSchema = z.object({ code: z.string(), path: z.string() }).strict();
const resultSchema = z.discriminatedUnion("kind", [
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
        "stale_content_version",
      ]),
    })
    .strict(),
  z.object({ kind: z.literal("infrastructure_error"), reference: z.string() }).strict(),
  z.object({ kind: z.literal("unexpected_error"), reference: z.string() }).strict(),
]);

export async function deleteMaterialDraft(
  input: DeleteMaterialDraftInput,
): Promise<DeleteMaterialDraftResult> {
  const formData = new FormData();
  formData.set("expectedContentVersion", String(input.expectedContentVersion));
  formData.set("materialId", input.materialId);
  formData.set("submissionId", input.submissionId);

  const response = await requestSameOriginMutation(
    "/api/authoring/materials",
    "DELETE",
    formData,
  );
  if (!response.ok) {
    return response.status === 401 || response.status === 403
      ? { kind: "unauthorized" }
      : {
          kind: "infrastructure_error",
          reference: `delete-material-draft-bff-${String(response.status)}`,
        };
  }
  const parsed = resultSchema.safeParse(response.body);
  if (!parsed.success) {
    return {
      kind: "unexpected_error",
      reference: "delete-material-draft-bff-contract",
    };
  }
  if (parsed.data.kind !== "conflict") return parsed.data;
  return parsed.data.currentContentVersion === undefined
    ? { kind: "conflict", reason: parsed.data.reason }
    : {
        currentContentVersion: parsed.data.currentContentVersion,
        kind: "conflict",
        reason: parsed.data.reason,
      };
}
