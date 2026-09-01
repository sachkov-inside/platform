import "server-only";

import {
  backendProxyProblem,
  copyBackendResponse,
  requestProfileAvatarMutation,
} from "@/shared/api/backend/index.server";
import { MAX_PROFILE_AVATAR_MUTATION_BYTES } from "@/shared/api/mutation-limits";
import {
  handleAuthenticatedMutation,
  type AuthenticatedMutationFailure,
} from "@/shared/auth/index.server";

export async function proxyProfileAvatarMutation(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(
    request,
    async (body, accessToken) => {
      const contentType = request.headers.get("content-type");
      const method =
        request.method === "PUT"
          ? "PUT"
          : request.method === "DELETE"
            ? "DELETE"
            : null;
      const acceptedContentType =
        method === "PUT"
          ? contentType?.toLowerCase().startsWith("multipart/form-data;") === true
          : method === "DELETE" &&
            contentType?.toLowerCase().startsWith("application/json") === true;
      if (
        body === null ||
        method === null ||
        !acceptedContentType ||
        contentType === null
      ) {
        return backendProxyProblem(
          422,
          "invalid_avatar",
          "Avatar request is malformed",
        );
      }
      const response = await requestProfileAvatarMutation({
        accessToken,
        body,
        contentType,
        method,
        signal: request.signal,
      });
      return copyBackendResponse(response);
    },
    {
      failureResponse: avatarMutationFailureResponse,
      maxBytes: MAX_PROFILE_AVATAR_MUTATION_BYTES,
      mode: "stream",
    },
  );
}

function avatarMutationFailureResponse(
  failure: AuthenticatedMutationFailure,
): Response {
  switch (failure) {
    case "cross_origin_request":
      return backendProxyProblem(
        403,
        failure,
        "Cross-origin avatar change is forbidden",
      );
    case "authentication_required":
      return backendProxyProblem(401, failure, "Authentication required");
    case "body_too_large":
      return backendProxyProblem(413, failure, "Avatar request is too large");
    case "identity_unavailable":
      return backendProxyProblem(
        503,
        failure,
        "Identity session is unavailable",
      );
    case "dependency_unavailable":
      return backendProxyProblem(503, failure, "Avatar change is unavailable");
  }
}
