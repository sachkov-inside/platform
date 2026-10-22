import { z } from "zod";

import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  ARTIFACT_NOT_ACCEPTED,
  ARTIFACT_TOO_LARGE,
  productArtifactAccessSchema,
  productArtifactMutationResultSchema,
  type ProductArtifactMutationResult,
} from "../model/product-artifacts";

/** The Products one artifact is placed in. */
export const productArtifactProductIdsSchema = z.array(z.uuid()).max(50);

// Обработчик читает только свои поля, как форма до #1679: лишние поля тела не мешают.
const metadataFields = {
  access: productArtifactAccessSchema,
  purpose: z.string().max(1000).default(""),
  title: z.string().min(1).max(200),
};
const externalUrlSchema = z.url({ protocol: /^https?$/u }).max(2048);

/** Maps a failed artifact request to the outcome the panel shows. */
export function productArtifactTransportFailure(
  failure: MutationTransportFailure,
): ProductArtifactMutationResult {
  if (failure.kind === "contract") {
    return { kind: "error", reference: "product-artifacts-bff-contract" };
  }
  if (failure.status === 401 || failure.status === 403) {
    return { kind: "unauthorized" };
  }
  if (failure.status === 413) {
    return { kind: "rejected", reason: ARTIFACT_TOO_LARGE };
  }
  if (failure.status === 400 || failure.status === 422) {
    return { kind: "rejected", reason: ARTIFACT_NOT_ACCEPTED };
  }
  return {
    kind: "error",
    reference: `product-artifacts-bff-${String(failure.status)}`,
  };
}

/** Adds an external link artifact to a Product. */
export const createProductArtifactFromLinkOperation = defineMutationOperation({
  input: z.object({
    ...metadataFields,
    externalUrl: externalUrlSchema,
    productId: z.uuid(),
  }),
  method: "POST",
  path: "/api/authoring/product-artifacts/links",
  result: productArtifactMutationResultSchema,
  transportFailure: productArtifactTransportFailure,
});

/** Changes the title, purpose and access of an artifact. */
export const updateProductArtifactOperation = defineMutationOperation({
  input: z.object({ ...metadataFields, artifactId: z.uuid() }),
  method: "PATCH",
  path: "/api/authoring/product-artifacts/metadata",
  result: productArtifactMutationResultSchema,
  transportFailure: productArtifactTransportFailure,
});

/** Points a link artifact at another address. */
export const replaceProductArtifactLinkOperation = defineMutationOperation({
  input: z.object({ artifactId: z.uuid(), externalUrl: externalUrlSchema }),
  method: "PUT",
  path: "/api/authoring/product-artifacts/link",
  result: productArtifactMutationResultSchema,
  transportFailure: productArtifactTransportFailure,
});

/** Archives or restores an artifact. */
export const setProductArtifactArchivedOperation = defineMutationOperation({
  input: z.object({ archived: z.boolean(), artifactId: z.uuid() }),
  method: "PUT",
  path: "/api/authoring/product-artifacts/archive",
  result: productArtifactMutationResultSchema,
  transportFailure: productArtifactTransportFailure,
});

/** Replaces the Products an artifact is placed in. */
export const setProductArtifactProductsOperation = defineMutationOperation({
  input: z.object({
    artifactId: z.uuid(),
    productIds: productArtifactProductIdsSchema,
  }),
  method: "PUT",
  path: "/api/authoring/product-artifacts/placements",
  result: productArtifactMutationResultSchema,
  transportFailure: productArtifactTransportFailure,
});

/** Removes an artifact that no Product references any more. */
export const removeProductArtifactOperation = defineMutationOperation({
  input: z.object({ artifactId: z.uuid() }),
  method: "DELETE",
  path: "/api/authoring/product-artifacts/removal",
  result: productArtifactMutationResultSchema,
  transportFailure: productArtifactTransportFailure,
});
