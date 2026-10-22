import "server-only";

import {
  requestVideoPlayback,
  requestVideoProgress,
} from "@/shared/api/backend/index.server";
import {
  handleMutationOperation,
  handleOptionalMutationOperation,
} from "@/shared/auth/index.server";

import {
  createMaterialVideoPlaybackSessionOperation,
  materialVideoPlaybackSessionSchema,
  saveMaterialVideoProgressOperation,
} from "./video-playback.operation";

export function handleVideoPlaybackSessionRequest(
  request: Request,
): Promise<Response> {
  return handleOptionalMutationOperation(
    request,
    createMaterialVideoPlaybackSessionOperation,
    {
      invalidInput: () => Response.json({ code: "not_found" }, { status: 404 }),
      execute: async (input, accessToken) => {
        const result = await requestVideoPlayback(
          {
            materialId: input.materialId,
            preview: input.preview === true,
            videoId: input.videoId,
          },
          accessToken,
        );
        if (!result.ok) {
          return Response.json(
            { code: "playback_unavailable" },
            { status: result.response.status },
          );
        }
        const parsed = materialVideoPlaybackSessionSchema.safeParse(
          result.body,
        );
        return parsed.success
          ? Response.json(parsed.data)
          : Response.json({ code: "invalid_response" }, { status: 502 });
      },
    },
  );
}

export function handleVideoProgressSaveRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, saveMaterialVideoProgressOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, accessToken) => {
      const result = await requestVideoProgress(input, accessToken);
      return result.ok ? { kind: "saved" } : { kind: "unavailable" };
    },
  });
}
