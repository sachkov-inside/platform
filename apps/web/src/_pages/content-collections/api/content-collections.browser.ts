import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  contentCollectionMutationResultSchema,
  type ContentCollectionMutationInput,
  type ContentCollectionMutationResult,
} from "../model/content-collections";

export async function mutateContentCollection(
  input: ContentCollectionMutationInput,
): Promise<ContentCollectionMutationResult> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    formData.set(key, String(value));
  }
  const response = await requestSameOriginMutation(
    "/api/authoring/collections",
    "PUT",
    formData,
  );
  if (!response.ok) {
    return response.status === 401 || response.status === 403
      ? { kind: "unauthorized" }
      : { kind: "error", reference: `collections-bff-${String(response.status)}` };
  }
  const parsed = contentCollectionMutationResultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "collections-bff-contract" };
}
