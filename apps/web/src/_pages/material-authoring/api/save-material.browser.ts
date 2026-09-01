import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type {
  SaveMaterialInput,
  SaveMaterialResult,
} from "../model/save-material";

const issueSchema = z.object({ message: z.string(), path: z.string() }).strict();
const resultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      contentVersion: z.number().int().positive(),
      kind: z.literal("saved"),
      nextSubmissionId: z.uuid(),
      publicationState: z.enum(["draft", "published", "unpublished"]),
    })
    .strict(),
  z.object({ issues: z.array(issueSchema), kind: z.literal("invalid_input") }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("not_found") }).strict(),
  z
    .object({
      currentContentVersion: z.number().int().positive(),
      kind: z.literal("conflict"),
      staleContentVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("infrastructure_error"), reference: z.string() }).strict(),
]);

export async function saveMaterial(
  input: SaveMaterialInput,
): Promise<SaveMaterialResult> {
  const formData = new FormData();
  formData.set("access", input.access);
  formData.set("document", JSON.stringify(input.document));
  formData.set("expectedContentVersion", String(input.expectedContentVersion));
  formData.set("formatId", input.formatId);
  formData.set("materialId", input.materialId);
  formData.set("publicationState", input.publicationState);
  formData.set("seriesIds", JSON.stringify(input.seriesIds));
  formData.set("submissionId", input.submissionId);
  formData.set("summary", input.summary);
  for (const tagId of input.tagIds) formData.append("tagIds", tagId);
  formData.set("title", input.title);
  formData.set("topicId", input.topicId);

  const response = await requestSameOriginMutation(
    "/api/authoring/materials",
    "PUT",
    formData,
  );
  if (!response.ok) {
    return response.status === 401 || response.status === 403
      ? { kind: "unauthorized" }
      : {
          kind: "infrastructure_error",
          reference: `save-material-bff-${String(response.status)}`,
        };
  }
  const parsed = resultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : { kind: "infrastructure_error", reference: "save-material-bff-contract" };
}
