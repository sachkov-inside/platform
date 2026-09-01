import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  deleteMaterialDraftResultSchema,
  type DeleteMaterialDraftInput,
  type DeleteMaterialDraftResult,
} from "../model/delete-material-draft";

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
  const parsed = deleteMaterialDraftResultSchema.safeParse(response.body);
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
