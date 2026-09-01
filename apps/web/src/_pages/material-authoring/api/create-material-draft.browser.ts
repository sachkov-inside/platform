import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type {
  CreateMaterialDraftInput,
  CreateMaterialDraftResult,
} from "../model/create-material-draft";

const issueSchema = z.object({ message: z.string(), path: z.string() }).strict();
const resultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      draft: z
        .object({
          contentVersion: z.number().int().positive(),
          materialId: z.uuid(),
        })
        .strict(),
      kind: z.literal("created"),
    })
    .strict(),
  z.object({ issues: z.array(issueSchema), kind: z.literal("invalid_input") }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("unexpected_error"), reference: z.string() }).strict(),
]);

export async function createMaterialDraft(
  input: CreateMaterialDraftInput,
): Promise<CreateMaterialDraftResult> {
  const formData = new FormData();
  formData.set("access", input.access);
  formData.set("document", JSON.stringify(input.document));
  formData.set("formatId", input.formatId);
  formData.set("seriesIds", JSON.stringify(input.seriesIds));
  formData.set("submissionId", input.submissionId);
  formData.set("summary", input.summary);
  for (const tagId of input.tagIds) formData.append("tagIds", tagId);
  formData.set("title", input.title);
  formData.set("topicId", input.topicId);

  const response = await requestSameOriginMutation(
    "/api/authoring/materials",
    "POST",
    formData,
  );
  if (!response.ok) {
    return response.status === 401 || response.status === 403
      ? { kind: "unauthorized" }
      : {
          kind: "unexpected_error",
          reference: `create-material-draft-bff-${String(response.status)}`,
        };
  }
  const parsed = resultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : { kind: "unexpected_error", reference: "create-material-draft-bff-contract" };
}
