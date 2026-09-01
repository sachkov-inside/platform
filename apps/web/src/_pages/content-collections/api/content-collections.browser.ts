import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  contentCollectionMutationResultSchema,
  type CreateContentCollectionInput,
  type CreateContentCollectionResult,
  type SetContentCollectionArchiveInput,
  type SetContentCollectionArchiveResult,
  type UpdateContentCollectionInput,
  type UpdateContentCollectionResult,
  type ContentCollectionMutationResult,
} from "../model/content-collections";

export async function createContentCollection(
  input: CreateContentCollectionInput,
): Promise<CreateContentCollectionResult> {
  return mapResult(await requestSameOriginMutation(
    "/api/authoring/collections",
    "POST",
    toFormData(input),
  ));
}

export async function updateContentCollection(
  input: UpdateContentCollectionInput,
): Promise<UpdateContentCollectionResult> {
  return mapResult(await requestSameOriginMutation(
    "/api/authoring/collections/metadata",
    "PUT",
    toFormData(input),
  ));
}

export async function setContentCollectionArchive(
  input: SetContentCollectionArchiveInput,
): Promise<SetContentCollectionArchiveResult> {
  return mapResult(await requestSameOriginMutation(
    "/api/authoring/collections/archive",
    "PUT",
    toFormData(input),
  ));
}

function mapResult(
  response: Awaited<ReturnType<typeof requestSameOriginMutation>>,
): ContentCollectionMutationResult {
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

function toFormData(input: object): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    formData.set(key, String(value));
  }
  return formData;
}
