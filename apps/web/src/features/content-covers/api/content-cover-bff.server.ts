import "server-only";

import {
  backendProxyProblem,
  copyBackendResponse,
  requestContentCoverDelivery,
  requestContentCoverRemoval,
  requestContentCoverUpload,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  isSameOriginMutation,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

const COVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WIDTH = /^[1-9][0-9]{1,3}$/u;

export async function proxyContentCoverDelivery(
  request: Request,
  coverId: string,
  width: string,
): Promise<Response> {
  if (!COVER_ID.test(coverId) || !WIDTH.test(width)) {
    return backendProxyProblem(404, "cover_not_found", "Cover not found");
  }
  try {
    return copyBackendResponse(
      await requestContentCoverDelivery({
        coverId,
        signal: request.signal,
        width,
      }),
    );
  } catch {
    return backendProxyProblem(
      503,
      "dependency_unavailable",
      "Cover delivery is unavailable",
    );
  }
}

export async function proxyContentCoverMutation(
  request: Request,
  ownerKind: string,
  ownerId: string,
): Promise<Response> {
  if (!isOwner(ownerKind) || !COVER_ID.test(ownerId)) {
    return backendProxyProblem(404, "cover_owner_not_found", "Cover owner not found");
  }
  const logtoConfig = readLogtoBffConfig();
  if (!isSameOriginMutation(request, logtoConfig.baseUrl)) {
    return backendProxyProblem(
      403,
      "cross_origin_request",
      "Cross-origin cover mutation is forbidden",
    );
  }
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(logtoConfig);
  } catch (error) {
    return error instanceof LogtoSessionUnavailableError
      ? backendProxyProblem(401, "authentication_required", "Authentication required")
      : backendProxyProblem(503, "identity_unavailable", "Identity session is unavailable");
  }
  try {
    if (request.method === "PUT") {
      const contentType = request.headers.get("content-type");
      if (
        request.body === null ||
        contentType?.toLowerCase().startsWith("multipart/form-data;") !== true
      ) {
        return backendProxyProblem(400, "invalid_cover", "Cover form is malformed");
      }
      return copyBackendResponse(
        await requestContentCoverUpload({
          accessToken,
          body: request.body,
          contentType,
          ownerId,
          ownerKind,
          signal: request.signal,
        }),
      );
    }
    const payload = (await request.json()) as { readonly expectedCoverId?: unknown };
    if (
      payload.expectedCoverId !== null &&
      (typeof payload.expectedCoverId !== "string" ||
        !COVER_ID.test(payload.expectedCoverId))
    ) {
      return backendProxyProblem(400, "invalid_cover", "Current cover is invalid");
    }
    return copyBackendResponse(
      await requestContentCoverRemoval({
        accessToken,
        expectedCoverId: payload.expectedCoverId,
        ownerId,
        ownerKind,
        signal: request.signal,
      }),
    );
  } catch {
    return backendProxyProblem(
      503,
      "dependency_unavailable",
      "Cover mutation is unavailable",
    );
  }
}

function isOwner(
  value: string,
): value is "material" | "series" | "topic" {
  return value === "material" || value === "series" || value === "topic";
}
