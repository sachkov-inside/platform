import { queryOptions } from "@tanstack/react-query";

import {
  productArtifactListStateSchema,
  productArtifactMutationResultSchema,
  type ProductArtifactAccess,
  type ProductArtifactListState,
  type ProductArtifactMutationResult,
} from "../model/product-artifacts";
import {
  createProductArtifactFromLinkOperation,
  productArtifactTransportFailure,
  removeProductArtifactOperation,
  replaceProductArtifactLinkOperation,
  setProductArtifactArchivedOperation,
  setProductArtifactProductsOperation,
  updateProductArtifactOperation,
} from "./product-artifacts.operation";

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
    await uploadArtifactFile(
      "/api/authoring/product-artifacts/uploads",
      "POST",
      body,
    ),
  );
}

export function createProductArtifactFromLink(input: {
  readonly externalUrl: string;
  readonly productId: string;
  readonly metadata: ProductArtifactMetadataDraft;
}): Promise<ProductArtifactMutationResult> {
  return createProductArtifactFromLinkOperation.send({
    ...input.metadata,
    externalUrl: input.externalUrl,
    productId: input.productId,
  });
}

export function updateProductArtifact(input: {
  readonly artifactId: string;
  readonly metadata: ProductArtifactMetadataDraft;
}): Promise<ProductArtifactMutationResult> {
  return updateProductArtifactOperation.send({
    ...input.metadata,
    artifactId: input.artifactId,
  });
}

export async function replaceProductArtifactFile(input: {
  readonly artifactId: string;
  readonly file: File;
}): Promise<ProductArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  await appendFile(body, input.file);
  return interpret(
    await uploadArtifactFile(
      "/api/authoring/product-artifacts/file",
      "PUT",
      body,
    ),
  );
}

export const replaceProductArtifactLink =
  replaceProductArtifactLinkOperation.send;

export const setProductArtifactArchived =
  setProductArtifactArchivedOperation.send;

export function setProductArtifactProducts(input: {
  readonly artifactId: string;
  readonly productIds: readonly string[];
}): Promise<ProductArtifactMutationResult> {
  return setProductArtifactProductsOperation.send({
    artifactId: input.artifactId,
    productIds: [...input.productIds],
  });
}

export const removeProductArtifact = removeProductArtifactOperation.send;

async function readArtifactList(
  url: string,
  signal: AbortSignal,
): Promise<ProductArtifactListState> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("product-artifacts-read");
  return productArtifactListStateSchema.parse(await response.json());
}

/** Maps one streamed upload outcome to the single artifact mutation result the panel reads. */
type UploadResult =
  | { readonly body: unknown; readonly ok: true }
  | { readonly ok: false; readonly status: number };

/**
 * A file travels as multipart to its streaming Route Handler, not as a JSON operation body
 * (ADR 0038): the same request a form mutation sent.
 */
async function uploadArtifactFile(
  path:
    | "/api/authoring/product-artifacts/file"
    | "/api/authoring/product-artifacts/uploads",
  method: "POST" | "PUT",
  body: FormData,
): Promise<UploadResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      body,
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      method,
    });
  } catch {
    return { ok: false, status: 503 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  try {
    return { body: await response.json(), ok: true };
  } catch {
    return { ok: false, status: 502 };
  }
}

function interpret(result: UploadResult): ProductArtifactMutationResult {
  if (!result.ok) {
    return productArtifactTransportFailure({
      kind: "status",
      status: result.status,
    });
  }
  const parsed = productArtifactMutationResultSchema.safeParse(result.body);
  return parsed.success
    ? parsed.data
    : productArtifactTransportFailure({ kind: "contract" });
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
