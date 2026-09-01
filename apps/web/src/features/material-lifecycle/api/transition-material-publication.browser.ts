import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  transitionMaterialPublicationResultSchema,
  type TransitionMaterialPublicationInput,
  type TransitionMaterialPublicationResult,
} from "../model/transition-material-publication";

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
  const parsed = transitionMaterialPublicationResultSchema.safeParse(
    response.body,
  );
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
