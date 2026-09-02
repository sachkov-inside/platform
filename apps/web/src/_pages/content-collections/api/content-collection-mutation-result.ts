import "server-only";

import type { BackendTransportResult } from "@/shared/api/backend/index.server";
import {
  contentCollectionSchema,
  type CreateContentCollectionResult,
  type ContentCollectionMutationResult,
  type SetContentCollectionArchiveResult,
  type UpdateContentCollectionResult,
} from "../model/content-collections";

export function mapCreateContentCollectionResult(
  result: BackendTransportResult,
): CreateContentCollectionResult {
  return mapContentCollectionMutationResult(result, "slug_conflict");
}

export function mapUpdateContentCollectionResult(
  result: BackendTransportResult,
): UpdateContentCollectionResult {
  return mapContentCollectionMutationResult(result, "conflict");
}

export function mapSetContentCollectionArchiveResult(
  result: BackendTransportResult,
): SetContentCollectionArchiveResult {
  return mapContentCollectionMutationResult(result, "conflict");
}

function mapContentCollectionMutationResult<
  ConflictKind extends "conflict" | "slug_conflict",
>(
  result: BackendTransportResult,
  conflictKind: ConflictKind,
):
  | Exclude<ContentCollectionMutationResult, { readonly kind: "conflict" | "slug_conflict" }>
  | { readonly kind: ConflictKind } {
  if (!result.ok) {
    if (result.response.status === 401 || result.response.status === 403) {
      return { kind: "unauthorized" };
    }
    if (result.response.status === 409) {
      return { kind: conflictKind };
    }
    if (result.response.status === 422) return { kind: "invalid" };
    return { kind: "error", reference: "collections-save" };
  }
  const collection = contentCollectionSchema.safeParse(result.body);
  return collection.success
    ? { kind: "saved", collection: collection.data }
    : { kind: "error", reference: "collections-receipt" };
}
