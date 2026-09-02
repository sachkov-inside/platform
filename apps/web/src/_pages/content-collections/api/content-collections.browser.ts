import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  createContentCollectionResultSchema,
  setContentCollectionArchiveResultSchema,
  updateContentCollectionResultSchema,
  type CreateContentCollectionInput,
  type CreateContentCollectionResult,
  type SetContentCollectionArchiveInput,
  type SetContentCollectionArchiveResult,
  type UpdateContentCollectionInput,
  type UpdateContentCollectionResult,
} from "../model/content-collections";

export async function createContentCollection(
  input: CreateContentCollectionInput,
): Promise<CreateContentCollectionResult> {
  const response = await requestSameOriginMutation(
    "/api/authoring/collections",
    "POST",
    toFormData(input),
  );
  if (!response.ok) return mapFailedResult(response);
  const parsed = createContentCollectionResultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "collections-bff-contract" };
}

export async function updateContentCollection(
  input: UpdateContentCollectionInput,
): Promise<UpdateContentCollectionResult> {
  const response = await requestSameOriginMutation(
    "/api/authoring/collections/metadata",
    "PUT",
    toFormData(input),
  );
  if (!response.ok) return mapFailedResult(response);
  const parsed = updateContentCollectionResultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "collections-bff-contract" };
}

export async function setContentCollectionArchive(
  input: SetContentCollectionArchiveInput,
): Promise<SetContentCollectionArchiveResult> {
  const response = await requestSameOriginMutation(
    "/api/authoring/collections/archive",
    "PUT",
    toFormData(input),
  );
  if (!response.ok) return mapFailedResult(response);
  const parsed = setContentCollectionArchiveResultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "collections-bff-contract" };
}

function mapFailedResult(
  response: Extract<
    Awaited<ReturnType<typeof requestSameOriginMutation>>,
    { readonly ok: false }
  >,
):
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly reference: string } {
  return response.status === 401 || response.status === 403
    ? { kind: "unauthorized" }
    : { kind: "error", reference: `collections-bff-${String(response.status)}` };
}

function toFormData(input: object): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    formData.set(key, String(value));
  }
  return formData;
}
