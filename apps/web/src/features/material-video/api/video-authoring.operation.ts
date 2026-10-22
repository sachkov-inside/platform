import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";
import { videoSchema } from "../model/video";

const uploadValueSchema = z
  .object({
    providerVideoId: z.string().min(1),
    uploadEndpoint: z.url(),
    video: videoSchema,
  })
  .strict();

const unavailable = { kind: "unavailable" } as const;

/**
 * The Route Handler forwards the backend value as is; the browser reads it with the value schema,
 * so a value outside that schema reads as unavailable, never as success.
 */
function videoMutationResultSchema<Value extends z.ZodType>(value: Value) {
  return z.union([
    z
      .object({ kind: z.literal("ready"), value: z.unknown() })
      .strict()
      .transform((ready) => {
        const parsed = value.safeParse(ready.value);
        return parsed.success
          ? { kind: "ready" as const, value: parsed.data }
          : unavailable;
      }),
    // Неверный ввод и отказ в доступе автор видит как обычную недоступность, как и раньше.
    z
      .object({
        kind: z.enum(["invalid_input", "unauthorized", "unavailable"]),
      })
      .strict()
      .transform(() => unavailable),
  ]);
}

const materialFieldsSchema = z
  .object({
    access: z.enum(["free", "closed"]),
    materialId: z.uuid(),
  })
  .strict();
const videoIdSchema = z.object({ videoId: z.uuid() }).strict();

/** Starts a platform upload of a Material video; `submissionId` keys its idempotency. */
export const initMaterialVideoUploadOperation = defineMutationOperation({
  input: materialFieldsSchema
    .extend({
      byteSize: z.number().int().positive(),
      filename: z.string().min(1).max(255),
      submissionId: z.uuid(),
      title: z.string().trim().min(1).max(255),
    })
    .strict(),
  method: "POST",
  path: "/api/authoring/material-video-uploads",
  result: z.union([
    z
      .object({
        kind: z.enum(["upload_not_authorized", "upload_outcome_unknown"]),
      })
      .strict(),
    videoMutationResultSchema(uploadValueSchema),
  ]),
  transportFailure: () => unavailable,
});

/** Attaches a video the author already holds at the provider. */
export const attachMaterialVideoOperation = defineMutationOperation({
  input: materialFieldsSchema
    .extend({ providerVideoId: z.string().trim().min(1).max(256) })
    .strict(),
  method: "POST",
  path: "/api/authoring/material-video-attachments",
  result: videoMutationResultSchema(videoSchema),
  transportFailure: () => unavailable,
});

/** Asks the provider how a Material video upload or processing ended. */
export const reconcileMaterialVideoOperation = defineMutationOperation({
  input: videoIdSchema,
  method: "POST",
  path: "/api/authoring/material-video-reconciliations",
  result: videoMutationResultSchema(videoSchema),
  transportFailure: () => unavailable,
});

/** Retries the provider deletion of a Material video that failed to delete. */
export const retryMaterialVideoDeletionOperation = defineMutationOperation({
  input: videoIdSchema,
  method: "POST",
  path: "/api/authoring/material-video-deletion-retries",
  result: videoMutationResultSchema(videoSchema),
  transportFailure: () => unavailable,
});
