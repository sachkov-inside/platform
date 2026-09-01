import "server-only";

import { readBackendBaseUrl } from "./transport-core.server";

const BACKEND_UPLOAD_TIMEOUT_MS = 60_000;

export function requestMaterialAssetUpload(input: {
  readonly accessToken: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly signal: AbortSignal;
}): Promise<Response> {
  const init: RequestInit & { duplex: "half" } = {
    body: input.body,
    cache: "no-store",
    duplex: "half",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": input.contentType,
      "idempotency-key": input.idempotencyKey,
    },
    method: "POST",
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(BACKEND_UPLOAD_TIMEOUT_MS),
    ]),
  };
  return fetch(
    `${readBackendBaseUrl()}/authoring/materials/${encodeURIComponent(input.materialId)}/assets`,
    init,
  );
}

export function requestMaterialAssetDelivery(input: {
  readonly accessToken?: string;
  readonly assetId: string;
  readonly contentVersion: number;
  readonly materialId: string;
  readonly preview: boolean;
  readonly signal: AbortSignal;
  readonly variantWidth?: string;
}): Promise<Response> {
  const path =
    input.variantWidth === undefined
      ? `/materials/${encodeURIComponent(input.materialId)}/assets/${encodeURIComponent(input.assetId)}`
      : `/materials/${encodeURIComponent(input.materialId)}/assets/${encodeURIComponent(input.assetId)}/images/${encodeURIComponent(input.variantWidth)}`;
  const url = new URL(`${readBackendBaseUrl()}${path}`);
  url.searchParams.set("contentVersion", String(input.contentVersion));
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
