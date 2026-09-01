import "server-only";

import { z } from "zod";

import { requestVideoAttach, requestVideoReconcile, requestVideoUploadInit } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

const uploadSchema = z.object({
  access: z.enum(["free", "membership"]),
  byteSize: z.coerce.number().int().positive(),
  filename: z.string().min(1).max(255),
  operation: z.literal("upload"),
  submissionId: z.uuid(),
  title: z.string().trim().min(1).max(255),
}).strict();
const attachSchema = z.object({
  access: z.enum(["free", "membership"]),
  operation: z.literal("attach"),
  providerVideoId: z.string().trim().min(1).max(256),
}).strict();

export function handleVideoAuthoringRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const operation = formData.get("operation");
    if (operation === "reconcile") {
      const videoId = formData.get("videoId");
      if (typeof videoId !== "string" || !z.uuid().safeParse(videoId).success) {
        return { kind: "invalid_input" };
      }
      const reconciled = await requestVideoReconcile(videoId, accessToken);
      return reconciled.ok
        ? { kind: "ready", value: reconciled.body }
        : { kind: "unavailable" };
    }
    const materialId = formData.get("materialId");
    if (typeof materialId !== "string") return { kind: "invalid_input" };
    const result = operation === "upload"
      ? await initUpload(formData, materialId, accessToken)
      : operation === "attach"
        ? await attach(formData, materialId, accessToken)
        : null;
    if (result === null) return { kind: "invalid_input" };
    if (!result.ok) {
      return result.response.status === 401 || result.response.status === 403
        ? { kind: "unauthorized" }
        : { kind: "unavailable" };
    }
    return { kind: "ready", value: result.body };
  });
}

function initUpload(formData: FormData, materialId: string, accessToken: string) {
  const parsed = uploadSchema.safeParse(Object.fromEntries(formData));
  return parsed.success && z.uuid().safeParse(materialId).success
    ? requestVideoUploadInit({
        ...parsed.data,
        idempotencyKey: `web-video-${parsed.data.submissionId}`,
        materialId,
      }, accessToken)
    : null;
}

function attach(formData: FormData, materialId: string, accessToken: string) {
  const parsed = attachSchema.safeParse(Object.fromEntries(formData));
  return parsed.success && z.uuid().safeParse(materialId).success
    ? requestVideoAttach({ ...parsed.data, materialId }, accessToken)
    : null;
}
