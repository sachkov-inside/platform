import { queryOptions } from "@tanstack/react-query";

import {
  requestSameOriginMutation,
  type SameOriginMutationResult,
} from "@/shared/api/same-origin-mutation";
import {
  ARTIFACT_NOT_ACCEPTED,
  ARTIFACT_TOO_LARGE,
  productArtifactListStateSchema,
  productArtifactMutationResultSchema,
  type ProductArtifactAccess,
  type ProductArtifactListState,
  type ProductArtifactMutationResult,
} from "../model/product-artifacts";

export interface ProductArtifactMetadataDraft {
  readonly access: ProductArtifactAccess;
  readonly purpose: string;
  readonly title: string;
}

export const productArtifactsQueryOptions = (productId: string) =>
  queryOptions({
    gcTime: 0,
    queryFn: ({ signal }) =>
      readArtifactList(
        `/api/authoring/products/${encodeURIComponent(productId)}/artifacts`,
        signal,
      ),
    queryKey: ["product-artifacts", productId],
    refetchOnWindowFocus: false,
  });

export const reusableProductArtifactsQueryOptions = () =>
  queryOptions({
    gcTime: 0,
    queryFn: ({ signal }) =>
      readArtifactList("/api/authoring/product-artifacts/reusable", signal),
    queryKey: ["product-artifacts", "reusable"],
    refetchOnWindowFocus: false,
  });

export async function createProductArtifactFromFile(input: {
  readonly file: File;
  readonly productId: string;
  readonly metadata: ProductArtifactMetadataDraft;
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  appendMetadata(body, input.metadata);
  body.set("productId", input.productId);
  await appendFile(body, input.file);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/product-artifacts/uploads",
      "POST",
      body,
    ),
  );
}

export async function createProductArtifactFromLink(input: {
  readonly externalUrl: string;
  readonly productId: string;
  readonly metadata: ProductArtifactMetadataDraft;
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  appendMetadata(body, input.metadata);
  body.set("externalUrl", input.externalUrl);
  body.set("productId", input.productId);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/product-artifacts/links",
      "POST",
      body,
    ),
  );
}

export async function updateProductArtifact(input: {
  readonly artifactId: string;
  readonly metadata: ProductArtifactMetadataDraft;
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  appendMetadata(body, input.metadata);
  body.set("artifactId", input.artifactId);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/product-artifacts/metadata",
      "PATCH",
      body,
    ),
  );
}

export async function replaceProductArtifactFile(input: {
  readonly artifactId: string;
  readonly file: File;
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  await appendFile(body, input.file);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/product-artifacts/file",
      "PUT",
      body,
    ),
  );
}

export async function replaceProductArtifactLink(input: {
  readonly artifactId: string;
  readonly externalUrl: string;
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  body.set("externalUrl", input.externalUrl);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/product-artifacts/link",
      "PUT",
      body,
    ),
  );
}

export async function setProductArtifactArchived(input: {
  readonly archived: boolean;
  readonly artifactId: string;
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  body.set("archived", String(input.archived));
  body.set("artifactId", input.artifactId);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/product-artifacts/archive",
      "PUT",
      body,
    ),
  );
}

export async function setProductArtifactProducts(input: {
  readonly artifactId: string;
  readonly productIds: readonly string[];
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  body.set("productIds", JSON.stringify(input.productIds));
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/product-artifacts/placements",
      "PUT",
      body,
    ),
  );
}

export async function removeProductArtifact(input: {
  readonly artifactId: string;
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/product-artifacts/removal",
      "DELETE",
      body,
    ),
  );
}

async function readArtifactList(
  url: string,
  signal: AbortSignal,
): Promise<ProductArtifactListState> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("product-artifacts-read");
  return productArtifactListStateSchema.parse(await response.json());
}

/** Maps one BFF outcome to the single artifact mutation result the panel reads. */
export function interpret(
  result: SameOriginMutationResult,
): ProductArtifactMutationResult {
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      return { kind: "unauthorized" };
    }
    if (result.status === 413) {
      return { kind: "rejected", reason: ARTIFACT_TOO_LARGE };
    }
    if (result.status === 400 || result.status === 422) {
      return { kind: "rejected", reason: ARTIFACT_NOT_ACCEPTED };
    }
    return {
      kind: "error",
      reference: `product-artifacts-bff-${String(result.status)}`,
    };
  }
  const parsed = productArtifactMutationResultSchema.safeParse(result.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "product-artifacts-bff-contract" };
}

function appendMetadata(
  body: FormData,
  metadata: ProductArtifactMetadataDraft,
): void {
  body.set("access", metadata.access);
  body.set("purpose", metadata.purpose);
  body.set("title", metadata.title);
}

async function appendFile(body: FormData, file: File): Promise<void> {
  body.set("checksumSha256", await sha256(file));
  body.set("declaredSize", String(file.size));
  body.set("file", file);
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
