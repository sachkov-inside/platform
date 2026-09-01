import "server-only";

import { z } from "zod";

import { requestVideoPlayback, requestVideoProgress } from "@/shared/api/backend/index.server";
import {
  getOptionalPlatformAccessToken,
  handleAuthenticatedMutation,
  isSameOriginMutation,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

const idSchema = z.uuid();
const sessionSchema = z.object({
  drmAuthToken: z.string().nullable(),
  embedLocator: z.url(),
  progressScope: z.enum(["account", "anonymous"]),
  resumeSeconds: z.number().int().nonnegative().nullable(),
  videoId: z.uuid(),
}).strict();
const progressSchema = z.object({
  durationSeconds: z.coerce.number().int().positive(),
  materialId: z.uuid(),
  positionSeconds: z.coerce.number().int().nonnegative(),
  videoId: z.uuid(),
}).strict();

export async function handleVideoPlaybackRequest(
  request: Request,
): Promise<Response> {
  if (!isSameOriginMutation(request, readLogtoBffConfig().baseUrl)) {
    return Response.json(
      { code: "cross_origin_request" },
      { headers: { "Cache-Control": "private, no-store", Vary: "cookie" }, status: 403 },
    );
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ code: "invalid_input" }, { status: 400 });
  }
  const materialId = formData.get("materialId");
  const videoId = formData.get("videoId");
  if (typeof materialId !== "string" || typeof videoId !== "string" ||
    !idSchema.safeParse(materialId).success || !idSchema.safeParse(videoId).success) {
    return Response.json({ code: "not_found" }, { status: 404 });
  }
  const result = await requestVideoPlayback(
    materialId,
    videoId,
    await getOptionalPlatformAccessToken(request),
  );
  if (!result.ok) {
    return Response.json({ code: "playback_unavailable" }, { status: result.response.status });
  }
  const parsed = sessionSchema.safeParse(result.body);
  return parsed.success
    ? Response.json(parsed.data, { headers: { "Cache-Control": "private, no-store" } })
    : Response.json({ code: "invalid_response" }, { status: 502 });
}

export function handleVideoProgressRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, async (formData, accessToken) => {
    const parsed = progressSchema.safeParse({
      durationSeconds: formData.get("durationSeconds"),
      materialId: formData.get("materialId"),
      positionSeconds: formData.get("positionSeconds"),
      videoId: formData.get("videoId"),
    });
    if (!parsed.success) return { kind: "invalid_input" };
    const result = await requestVideoProgress(parsed.data, accessToken);
    return result.ok ? { kind: "saved" } : { kind: "unavailable" };
  });
}
