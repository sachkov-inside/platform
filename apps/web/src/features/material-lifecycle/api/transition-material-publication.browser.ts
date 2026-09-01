import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type {
  TransitionMaterialPublicationInput,
  TransitionMaterialPublicationResult,
} from "../model/transition-material-publication";

const issueSchema = z.object({ code: z.string(), path: z.string() }).strict();
const resultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      contentVersion: z.number().int().positive(),
      kind: z.literal("saved"),
      nextSubmissionId: z.uuid(),
      publicationState: z.enum(["published", "unpublished"]),
    })
    .strict(),
  z.object({ kind: z.literal("invalid_input"), issues: z.array(issueSchema) }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("not_found") }).strict(),
  z
    .object({
      currentContentVersion: z.number().int().positive().optional(),
      kind: z.literal("conflict"),
      reason: z.enum([
        "idempotency_key_reused",
        "invalid_publication_transition",
        "stale_content_version",
      ]),
    })
    .strict(),
  z.object({ kind: z.literal("infrastructure_error"), reference: z.string() }).strict(),
  z.object({ kind: z.literal("unexpected_error"), reference: z.string() }).strict(),
]);

export async function transitionMaterialPublication(
  input: TransitionMaterialPublicationInput,
): Promise<TransitionMaterialPublicationResult> {
  const formData = new FormData();
  formData.set("expectedContentVersion", String(input.expectedContentVersion));
  formData.set("materialId", input.materialId);
  formData.set("publicationState", input.publicationState);
  formData.set("submissionId", input.submissionId);

  const response = await requestSameOriginMutation(
    "/api/authoring/materials",
    "PATCH",
    formData,
  );
  if (!response.ok) {
    return response.status === 401 || response.status === 403
      ? { kind: "unauthorized" }
      : {
          kind: "infrastructure_error",
          reference: `transition-material-publication-bff-${String(response.status)}`,
        };
  }
  const parsed = resultSchema.safeParse(response.body);
  if (!parsed.success) {
    return {
      kind: "unexpected_error",
      reference: "transition-material-publication-bff-contract",
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
