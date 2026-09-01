import "server-only";

import {
  readBackendBaseUrl,
} from "@/shared/api/backend/index.server";
import {
  getOptionalPlatformAccessToken,
  getPlatformAccessToken,
  isSameOriginMutation,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

const UPLOAD_TIMEOUT_MS = 60_000;

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
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return problem(400, "invalid_upload", "Upload form is malformed");
  }
  const response = await fetch(
    `${readBackendBaseUrl()}/authoring/materials/${encodeURIComponent(materialId)}/assets`,
    {
      body: formData,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "idempotency-key": idempotencyKey,
      },
      method: "POST",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)]),
    },
  );
  return copyBackendResponse(response);
}

export async function proxyMaterialAssetDelivery(
  request: Request,
  path: string,
): Promise<Response> {
  const accessToken = await getOptionalPlatformAccessToken(request);
  const incomingUrl = new URL(request.url);
  const backendUrl = new URL(`${readBackendBaseUrl()}${path}`);
  if (incomingUrl.searchParams.get("preview") === "true") {
    backendUrl.searchParams.set("preview", "true");
  }
  const response = await fetch(backendUrl, {
    cache: "no-store",
    headers: accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
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
