import "server-only";

import { z } from "zod";

import type { BackendTransportResult } from "@/shared/api/backend/index.server";
import {
  contentCollectionSchema,
  type ContentCollectionMutationResult,
} from "../model/content-collections";

export function mapContentCollectionMutationResult(
  result: BackendTransportResult,
): ContentCollectionMutationResult {
  if (!result.ok) {
    if (result.response.status === 401 || result.response.status === 403) {
      return { kind: "unauthorized" };
    }
    if (result.response.status === 409) {
      const code = z.looseObject({ code: z.string() }).safeParse(result.problem);
      return code.success && code.data.code === "content_collection_slug_conflict"
        ? { kind: "slug_conflict" }
        : { kind: "conflict" };
    }
    if (result.response.status === 422) return { kind: "invalid" };
    return { kind: "error", reference: "collections-save" };
  }
  const collection = contentCollectionSchema.safeParse(result.body);
  return collection.success
    ? { kind: "saved", collection: collection.data }
    : { kind: "error", reference: "collections-receipt" };
}
