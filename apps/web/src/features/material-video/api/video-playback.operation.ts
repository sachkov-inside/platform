import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

export const materialVideoPlaybackSessionSchema = z
  .object({
    drmAuthToken: z.string().nullable(),
    embedLocator: z.url(),
    progressScope: z.enum(["account", "anonymous"]),
    resumeSeconds: z.number().int().nonnegative().nullable(),
    videoId: z.uuid(),
  })
  .strict();

/**
 * Opens a playback session for a Material video; a guest may open one too. Any refusal leaves the
 * player without a session.
 */
export const createMaterialVideoPlaybackSessionOperation =
  defineMutationOperation({
    input: z.object({
      materialId: z.uuid(),
      /** Author preview of the current saved Material: the backend checks `materials:manage`. */
      preview: z.literal(true).optional(),
      videoId: z.uuid(),
    }),
    method: "POST",
    path: "/api/material-video-playback-sessions",
    result: materialVideoPlaybackSessionSchema.nullable(),
    transportFailure: () => null,
  });

/** Saves the signed-in viewer's position in a Material video; the player only learns success. */
export const saveMaterialVideoProgressOperation = defineMutationOperation({
  input: z.object({
    durationSeconds: z.number().int().positive(),
    materialId: z.uuid(),
    positionSeconds: z.number().int().nonnegative(),
    videoId: z.uuid(),
  }),
  method: "PUT",
  path: "/api/material-video-progress",
  // Любой ответ маршрута со статусом 200 значит, что запрос дошёл; иначе позиция не сохранена.
  result: z.unknown().transform(() => true),
  transportFailure: () => false,
});
