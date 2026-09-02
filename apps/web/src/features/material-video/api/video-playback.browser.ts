import { z } from "zod";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

const sessionSchema = z.object({
  drmAuthToken: z.string().nullable(),
  embedLocator: z.url(),
  progressScope: z.enum(["account", "anonymous"]),
  resumeSeconds: z.number().int().nonnegative().nullable(),
  videoId: z.uuid(),
}).strict();

export type MaterialVideoPlaybackSession = z.infer<typeof sessionSchema>;

export async function createMaterialVideoPlaybackSession(input: {
  readonly materialId: string;
  readonly videoId: string;
}): Promise<MaterialVideoPlaybackSession | null> {
  const formData = new FormData();
  formData.set("materialId", input.materialId);
  formData.set("videoId", input.videoId);
  const response = await requestSameOriginMutation(
    "/api/material-video-playback-sessions",
    "POST",
    formData,
  );
  if (!response.ok) return null;
  const parsed = sessionSchema.safeParse(response.body);
  return parsed.success ? parsed.data : null;
}

export async function saveMaterialVideoProgress(input: {
  readonly durationSeconds: number;
  readonly materialId: string;
  readonly positionSeconds: number;
  readonly videoId: string;
}): Promise<boolean> {
  const formData = new FormData();
  formData.set("durationSeconds", String(input.durationSeconds));
  formData.set("materialId", input.materialId);
  formData.set("positionSeconds", String(input.positionSeconds));
  formData.set("videoId", input.videoId);
  const response = await requestSameOriginMutation(
    "/api/material-video-progress",
    "PUT",
    formData,
  );
  return response.ok;
}
