import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  saveMaterialResultSchema,
  type SaveMaterialInput,
  type SaveMaterialResult,
} from "../model/save-material";

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
  const parsed = saveMaterialResultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : { kind: "infrastructure_error", reference: "save-material-bff-contract" };
}
