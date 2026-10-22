import "server-only";

import { z } from "zod";

import {
  requestVideoAttach,
  requestVideoDeletionRetry,
  requestVideoReconcile,
  requestVideoUploadInit,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import {
  attachMaterialVideoOperation,
  initMaterialVideoUploadOperation,
  reconcileMaterialVideoOperation,
  retryMaterialVideoDeletionOperation,
} from "./video-authoring.operation";

export function handleVideoUploadRequest(request: Request): Promise<Response> {
  return handleMutationOperation(request, initMaterialVideoUploadOperation, {
    invalidInput,
    execute: async ({ submissionId, ...upload }, accessToken) =>
      mapVideoUploadResult(
        await requestVideoUploadInit(
          {
            ...upload,
            idempotencyKey: `web-video-${submissionId}`,
          },
          accessToken,
        ),
      ),
  });
}

export function handleVideoAttachmentRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, attachMaterialVideoOperation, {
    invalidInput,
    execute: async (attachment, accessToken) =>
      mapVideoResult(await requestVideoAttach(attachment, accessToken)),
  });
}

export function handleVideoReconciliationRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, reconcileMaterialVideoOperation, {
    invalidInput,
    execute: async ({ videoId }, accessToken) =>
      mapVideoResult(await requestVideoReconcile(videoId, accessToken)),
  });
}

export function handleVideoDeletionRetryRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, retryMaterialVideoDeletionOperation, {
    invalidInput,
    execute: async ({ videoId }, accessToken) =>
      mapVideoResult(await requestVideoDeletionRetry(videoId, accessToken)),
  });
}

function invalidInput() {
  return { kind: "invalid_input" as const };
}

function mapVideoResult(
  result: Awaited<ReturnType<typeof requestVideoAttach>>,
) {
  if (!result.ok) {
    return result.response.status === 401 || result.response.status === 403
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const };
  }
  return { kind: "ready" as const, value: result.body };
}

function mapVideoUploadResult(
  result: Awaited<ReturnType<typeof requestVideoUploadInit>>,
) {
  if (
    !result.ok &&
    (result.response.status === 409 || result.response.status === 503)
  ) {
    const failure = z
      .object({
        code: z.enum(["upload_not_authorized", "upload_outcome_unknown"]),
      })
      .safeParse(result.problem);
    if (failure.success) return { kind: failure.data.code };
  }
  return mapVideoResult(result);
}
