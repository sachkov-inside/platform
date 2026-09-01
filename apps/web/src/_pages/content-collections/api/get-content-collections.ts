import "server-only";

import {
  BackendConnectionError,
  requestContentCollections,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import {
  contentCollectionSchema,
  type ContentCollection,
  type ContentCollectionKind,
} from "../model/content-collections";

export type ContentCollectionsState =
  | { readonly kind: "ready"; readonly collections: readonly ContentCollection[] }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly reference: string };

export async function getContentCollections(
  kind: ContentCollectionKind,
  accessToken: string,
  request: typeof requestContentCollections = requestContentCollections,
): Promise<ContentCollectionsState> {
  let result: BackendTransportResult;
  try {
    result = await request(kind, accessToken);
  } catch (error) {
    return {
      kind: "error",
      reference:
        error instanceof BackendConnectionError ? error.code : "collections-request",
    };
  }
  if (!result.ok) {
    return result.response.status === 401 || result.response.status === 403
      ? { kind: "unauthorized" }
      : { kind: "error", reference: "collections-response" };
  }
  const parsed = contentCollectionSchema.array().safeParse(result.body);
  return parsed.success
    ? { kind: "ready", collections: parsed.data }
    : { kind: "error", reference: "collections-contract" };
}
