import type { z } from "zod";

import {
  createMaterialVideoPlaybackSessionOperation,
  saveMaterialVideoProgressOperation,
  type materialVideoPlaybackSessionSchema,
} from "./video-playback.operation";

export type MaterialVideoPlaybackSession = z.infer<
  typeof materialVideoPlaybackSessionSchema
>;

export function createMaterialVideoPlaybackSession(input: {
  readonly materialId: string;
  /** Author preview of the current saved Material: the backend checks `materials:manage`. */
  readonly preview?: boolean;
  readonly videoId: string;
}): Promise<MaterialVideoPlaybackSession | null> {
  return createMaterialVideoPlaybackSessionOperation.send({
    materialId: input.materialId,
    videoId: input.videoId,
    ...(input.preview === true ? { preview: true } : {}),
  });
}

export const saveMaterialVideoProgress =
  saveMaterialVideoProgressOperation.send;
