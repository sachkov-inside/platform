import "server-only";

import { z } from "zod";

import {
  backendProxyProblem,
  copyBackendResponse,
  requestContentCoverDelivery,
  requestContentCoverRemoval,
  requestContentCoverUpload,
} from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedMutation,
  type AuthenticatedMutationFailure,
} from "@/shared/auth/index.server";
import { MAX_CONTENT_COVER_MUTATION_BYTES } from "@/shared/api/mutation-limits";

const coverIdSchema = z.uuid();
const ownerKindSchema = z.enum(["material", "series", "topic"]);
const coverWidthSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,3}$/u)
  .transform(Number)
  .pipe(z.number().int().positive().max(9_999));
const removalBodySchema = z
  .object({ expectedCoverId: z.uuid().nullable() })
  .strict();

export async function proxyContentCoverDelivery(
  request: Request,
  coverId: string,
  width: string,
): Promise<Response> {
  const parsedCoverId = coverIdSchema.safeParse(coverId);
  const parsedWidth = coverWidthSchema.safeParse(width);
  if (!parsedCoverId.success || !parsedWidth.success) {
    return backendProxyProblem(404, "cover_not_found", "Cover not found");
  }
  try {
    return copyBackendResponse(
      await requestContentCoverDelivery({
        coverId: parsedCoverId.data,
        signal: request.signal,
        width: String(parsedWidth.data),
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

export async function proxyContentCoverUpload(
  request: Request,
  ownerKind: string,
  ownerId: string,
): Promise<Response> {
  const owner = parseOwner(ownerKind, ownerId);
  if (owner === undefined) return invalidOwner();
  return handleAuthenticatedMutation(
    request,
    async (body, accessToken) => {
      const contentType = request.headers.get("content-type");
      if (
        body === null ||
        contentType?.toLowerCase().startsWith("multipart/form-data;") !== true
      ) {
        return backendProxyProblem(400, "invalid_cover", "Cover form is malformed");
      }
      return copyBackendResponse(
        await requestContentCoverUpload({
          accessToken,
          body,
          contentType,
          ownerId: owner.id,
          ownerKind: owner.kind,
          signal: request.signal,
        }),
      );
    },
    streamingMutationOptions,
  );
}

export async function proxyContentCoverRemoval(
  request: Request,
  ownerKind: string,
  ownerId: string,
): Promise<Response> {
  const owner = parseOwner(ownerKind, ownerId);
  if (owner === undefined) return invalidOwner();
  return handleAuthenticatedMutation(
    request,
    async (body, accessToken) => {
      if (
        body === null ||
        request.headers.get("content-type")?.toLowerCase().startsWith("application/json") !== true
      ) {
        return backendProxyProblem(400, "invalid_cover", "Cover removal is malformed");
      }
      let input: unknown;
      try {
        input = await new Response(body).json();
      } catch {
        return backendProxyProblem(400, "invalid_cover", "Cover removal is malformed");
      }
      const parsed = removalBodySchema.safeParse(input);
      if (!parsed.success) {
        return backendProxyProblem(400, "invalid_cover", "Current cover is invalid");
      }
      return copyBackendResponse(
        await requestContentCoverRemoval({
          accessToken,
          expectedCoverId: parsed.data.expectedCoverId,
          ownerId: owner.id,
          ownerKind: owner.kind,
          signal: request.signal,
        }),
      );
    },
    streamingMutationOptions,
  );
}

const streamingMutationOptions = {
  failureResponse: coverMutationFailure,
  maxBytes: MAX_CONTENT_COVER_MUTATION_BYTES,
  mode: "stream",
} as const;

function parseOwner(ownerKind: string, ownerId: string) {
  const kind = ownerKindSchema.safeParse(ownerKind);
  const id = coverIdSchema.safeParse(ownerId);
  return kind.success && id.success ? { id: id.data, kind: kind.data } : undefined;
}

function invalidOwner(): Response {
  return backendProxyProblem(404, "cover_owner_not_found", "Cover owner not found");
}

function coverMutationFailure(failure: AuthenticatedMutationFailure): Response {
  switch (failure) {
    case "authentication_required":
      return backendProxyProblem(401, failure, "Authentication required");
    case "body_too_large":
      return backendProxyProblem(413, "invalid_cover", "Cover exceeds the size limit");
    case "cross_origin_request":
      return backendProxyProblem(403, failure, "Cross-origin cover mutation is forbidden");
    case "dependency_unavailable":
      return backendProxyProblem(503, failure, "Cover mutation is unavailable");
    case "identity_unavailable":
      return backendProxyProblem(503, failure, "Identity session is unavailable");
  }
}
