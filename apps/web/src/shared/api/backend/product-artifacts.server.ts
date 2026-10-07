import "server-only";

import { ProductArtifactsService } from "./generated/platform-api/services/ProductArtifactsService";
import { MaterialAuthoringService } from "./generated/platform-api/services/MaterialAuthoringService";
import {
  executeGeneratedRequest,
  readBackendBaseUrl,
  type BackendTransportResult,
} from "./transport-core.server";

const PRODUCT_ARTIFACT_UPLOAD_TIMEOUT_MS = 60_000;

export interface ProductArtifactMetadataInput {
  readonly access: "free" | "closed";
  readonly purpose: string;
  readonly title: string;
}

/** The reader section of one Product, already narrowed by the viewer's access. */
export function requestReaderProductArtifacts(
  productId: string,
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ProductArtifactsService(request).readProductArtifacts({ productId }),
    200,
    options,
  );
}

/** Binary or redirect delivery cannot pass through the generated JSON client. */
export function requestReaderProductArtifactFile(input: {
  readonly accessToken?: string;
  readonly artifactId: string;
  readonly productId: string;
  readonly preview: boolean;
  readonly signal: AbortSignal;
  readonly version: number;
}): Promise<Response> {
  const url = new URL(
    `${readBackendBaseUrl()}/products/${encodeURIComponent(input.productId)}/artifacts/${encodeURIComponent(input.artifactId)}/file`,
  );
  url.searchParams.set("version", String(input.version));
  if (input.preview) url.searchParams.set("preview", "true");
  return fetch(url, {
    cache: "no-store",
    headers:
      input.accessToken === undefined
        ? {}
        : { authorization: `Bearer ${input.accessToken}` },
    redirect: "manual",
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]),
  });
}

export function requestProductArtifactsForProduct(
  productId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).listAuthoringProductArtifacts({
        productId,
      }),
    200,
    { accessToken },
  );
}

export function requestReusableProductArtifacts(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).listReusableProductArtifacts(),
    200,
    { accessToken },
  );
}

export function requestCreateProductArtifactFromLink(
  input: ProductArtifactMetadataInput & {
    readonly externalUrl: string;
    readonly productId: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).createProductArtifactFromLink({
        requestBody: input,
      }),
    201,
    { accessToken },
  );
}

export function requestUpdateProductArtifact(
  input: ProductArtifactMetadataInput & { readonly artifactId: string },
  accessToken: string,
): Promise<BackendTransportResult> {
  const { artifactId, ...metadata } = input;
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).updateProductArtifact({
        artifactId,
        requestBody: metadata,
      }),
    200,
    { accessToken },
  );
}

export function requestReplaceProductArtifactLink(
  input: { readonly artifactId: string; readonly externalUrl: string },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).replaceProductArtifactLink({
        artifactId: input.artifactId,
        requestBody: { externalUrl: input.externalUrl },
      }),
    200,
    { accessToken },
  );
}

export function requestSetProductArtifactArchived(
  input: { readonly archived: boolean; readonly artifactId: string },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).setProductArtifactArchived({
        artifactId: input.artifactId,
        requestBody: { archived: input.archived },
      }),
    200,
    { accessToken },
  );
}

export function requestSetProductArtifactProducts(
  input: {
    readonly artifactId: string;
    readonly productIds: readonly string[];
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).setProductArtifactProducts({
        artifactId: input.artifactId,
        requestBody: { productIds: [...input.productIds] },
      }),
    200,
    { accessToken },
  );
}

export function requestRemoveProductArtifact(
  artifactId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).removeProductArtifact({
        artifactId,
      }),
    200,
    { accessToken },
  );
}

/**
 * File uploads stream straight through the BFF: the artifact body may reach the
 * 25 MiB product limit, which no buffered mutation boundary carries.
 */
export function requestCreateProductArtifactFile(input: {
  readonly accessToken: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly signal: AbortSignal;
}): Promise<Response> {
  return streamUpload(
    `${readBackendBaseUrl()}/authoring/product-artifacts/files`,
    "POST",
    input,
  );
}

export function requestReplaceProductArtifactFile(input: {
  readonly accessToken: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly signal: AbortSignal;
}): Promise<Response> {
  return streamUpload(
    `${readBackendBaseUrl()}/authoring/product-artifacts/file`,
    "PUT",
    input,
  );
}

function streamUpload(
  url: string,
  method: "POST" | "PUT",
  input: {
    readonly accessToken: string;
    readonly body: ReadableStream<Uint8Array>;
    readonly contentType: string;
    readonly signal: AbortSignal;
  },
): Promise<Response> {
  return fetch(url, {
    body: input.body,
    cache: "no-store",
    duplex: "half",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": input.contentType,
    },
    method,
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(PRODUCT_ARTIFACT_UPLOAD_TIMEOUT_MS),
    ]),
  } as RequestInit & { duplex: "half" });
}
