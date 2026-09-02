import "server-only";

import { z } from "zod";

import { requestVideoAttach, requestVideoDeletionRetry, requestVideoReconcile, requestVideoUploadInit } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

const materialSchema = z.object({
  access: z.enum(["free", "membership"]),
  materialId: z.uuid(),
}).strict();
const uploadSchema = materialSchema.extend({
  byteSize: z.coerce.number().int().positive(),
  filename: z.string().min(1).max(255),
  submissionId: z.uuid(),
  title: z.string().trim().min(1).max(255),
}).strict();
const attachmentSchema = materialSchema.extend({
  providerVideoId: z.string().trim().min(1).max(256),
}).strict();
const reconciliationSchema = z.object({ videoId: z.uuid() }).strict();

export function handleVideoUploadRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const parsed = uploadSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { kind: "invalid_input" };
    const { submissionId, ...upload } = parsed.data;
    return mapVideoResult(await requestVideoUploadInit({
      ...upload,
      idempotencyKey: `web-video-${submissionId}`,
    }, accessToken));
  });
}

export function handleVideoAttachmentRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const parsed = attachmentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { kind: "invalid_input" };
    return mapVideoResult(await requestVideoAttach(parsed.data, accessToken));
  });
}

export function handleVideoReconciliationRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const parsed = reconciliationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { kind: "invalid_input" };
    const reconciled = await requestVideoReconcile(parsed.data.videoId, accessToken);
    return reconciled.ok
      ? { kind: "ready", value: reconciled.body }
      : { kind: "unavailable" };
  });
}

export function handleVideoDeletionRetryRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const parsed = reconciliationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { kind: "invalid_input" };
    const retried = await requestVideoDeletionRetry(parsed.data.videoId, accessToken);
    return retried.ok
      ? { kind: "ready", value: retried.body }
      : { kind: "unavailable" };
  });
}

function mapVideoResult(result: Awaited<ReturnType<typeof requestVideoAttach>>) {
  if (!result.ok) {
    return result.response.status === 401 || result.response.status === 403
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const };
  }
  return { kind: "ready" as const, value: result.body };
}
