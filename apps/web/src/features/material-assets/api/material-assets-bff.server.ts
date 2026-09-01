import "server-only";

import {
  backendProxyProblem,
  copyBackendResponse,
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
    return backendProxyProblem(
      403,
      "cross_origin_request",
      "Cross-origin upload is forbidden",
    );
  }
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(logtoConfig);
  } catch (error) {
    return error instanceof LogtoSessionUnavailableError
      ? backendProxyProblem(401, "authentication_required", "Authentication required")
      : backendProxyProblem(
          503,
          "identity_unavailable",
          "Identity session is unavailable",
        );
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey === null) {
    return backendProxyProblem(400, "invalid_upload", "Idempotency key is required");
  }
  const contentType = request.headers.get("content-type");
  if (request.body === null || contentType?.toLowerCase().startsWith("multipart/form-data;") !== true) {
    return backendProxyProblem(400, "invalid_upload", "Upload form is malformed");
  }
  try {
    const response = await requestMaterialAssetUpload({
      accessToken,
      body: request.body,
      contentType,
      idempotencyKey,
      materialId,
      signal: request.signal,
    });
    return copyBackendResponse(response);
  } catch {
    return backendProxyProblem(
      503,
      "dependency_unavailable",
      "Asset upload is unavailable",
    );
  }
}

export async function proxyMaterialAssetDelivery(
  request: Request,
  input: {
    readonly assetId: string;
    readonly materialId: string;
    readonly variantWidth?: string;
  },
): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const preview = incomingUrl.searchParams.get("preview");
  const contentVersion = Number(incomingUrl.searchParams.get("contentVersion"));
  if (
    !Number.isInteger(contentVersion) ||
    contentVersion < 1 ||
    (preview !== null && preview !== "false" && preview !== "true")
  ) {
    return backendProxyProblem(404, "asset_not_found", "Asset not found");
  }
  try {
    const accessToken = await getOptionalPlatformAccessToken(request);
    const response = await requestMaterialAssetDelivery({
      ...(accessToken === undefined ? {} : { accessToken }),
      assetId: input.assetId,
      contentVersion,
      materialId: input.materialId,
      preview: preview === "true",
      signal: request.signal,
      ...(input.variantWidth === undefined ? {} : { variantWidth: input.variantWidth }),
    });
    return copyBackendResponse(response);
  } catch {
    return backendProxyProblem(
      503,
      "dependency_unavailable",
      "Asset delivery is unavailable",
    );
  }
}
