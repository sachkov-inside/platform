import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  createMaterialDraftResultSchema,
  type CreateMaterialDraftInput,
  type CreateMaterialDraftResult,
} from "../model/create-material-draft";

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
  const parsed = createMaterialDraftResultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : { kind: "unexpected_error", reference: "create-material-draft-bff-contract" };
}
