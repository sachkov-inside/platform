import "server-only";

import {
  requestMaterialAssetDelivery,
  requestMaterialAssetUpload,
} from "@/shared/api/backend/index.server";
import {
  getOptionalPlatformAccessToken,
  getPlatformAccessToken,
  isSameOriginMutation,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

export async function proxyMaterialAssetUpload(
  request: Request,
  materialId: string,
): Promise<Response> {
  const logtoConfig = readLogtoBffConfig();
  if (!isSameOriginMutation(request, logtoConfig.baseUrl)) {
    return problem(403, "cross_origin_request", "Cross-origin upload is forbidden");
  }
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(logtoConfig);
  } catch (error) {
    return error instanceof LogtoSessionUnavailableError
      ? problem(401, "authentication_required", "Authentication required")
      : problem(503, "identity_unavailable", "Identity session is unavailable");
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey === null) {
    return problem(400, "invalid_upload", "Idempotency key is required");
  }
  const contentType = request.headers.get("content-type");
  if (request.body === null || contentType?.toLowerCase().startsWith("multipart/form-data;") !== true) {
    return problem(400, "invalid_upload", "Upload form is malformed");
  }
  const response = await requestMaterialAssetUpload({
    accessToken,
    body: request.body,
    contentType,
    idempotencyKey,
    materialId,
    signal: request.signal,
  });
  return copyBackendResponse(response);
}

export async function proxyMaterialAssetDelivery(
  request: Request,
  input: {
    readonly assetId: string;
    readonly materialId: string;
    readonly variantWidth?: string;
  },
): Promise<Response> {
  const accessToken = await getOptionalPlatformAccessToken(request);
  const incomingUrl = new URL(request.url);
  const response = await requestMaterialAssetDelivery({
    ...(accessToken === undefined ? {} : { accessToken }),
    assetId: input.assetId,
    materialId: input.materialId,
    preview: incomingUrl.searchParams.get("preview") === "true",
    signal: request.signal,
    ...(input.variantWidth === undefined ? {} : { variantWidth: input.variantWidth }),
  });
  return copyBackendResponse(response);
}

function copyBackendResponse(response: Response): Response {
  const headers = new Headers();
  for (const name of [
    "cache-control",
    "content-disposition",
    "content-length",
    "content-type",
    "location",
    "x-content-type-options",
  ]) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(response.body, { headers, status: response.status });
}

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `urn:inside:problem:${code}`, title, status, code },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
