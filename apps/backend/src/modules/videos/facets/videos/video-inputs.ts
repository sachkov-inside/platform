import { z } from "zod";

import {
  providerVideoIdSchema,
  videoAccountIdSchema,
  videoIdempotencyKeySchema,
  videoIdSchema,
  videoMaterialIdSchema,
} from "../../domain/video-identifiers.js";
import { videoAccessSchema } from "./videos.interface.js";

// Input schemas of the Videos facet: every operation parses its input here first.
export const initInput = z.object({
  access: videoAccessSchema,
  actor: videoAccountIdSchema,
  byteSize: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
  filename: z.string().trim().min(1).max(255),
  idempotencyKey: videoIdempotencyKeySchema,
  materialId: videoMaterialIdSchema,
  title: z.string().trim().min(1).max(255),
}).strict();
export const attachInput = z.object({
  access: videoAccessSchema,
  actor: videoAccountIdSchema,
  materialId: videoMaterialIdSchema,
  providerVideoId: providerVideoIdSchema,
}).strict();
export const reconcileInput = z.object({ actor: videoAccountIdSchema, videoId: videoIdSchema }).strict();
export const retryDeletionInput = reconcileInput;
export const webhookInput = z.object({
  event: z.string().trim().min(1).max(128),
  providerStatus: z.string().trim().min(1).max(64).optional(),
  providerVideoId: providerVideoIdSchema,
}).strict();
export const primaryReferenceInput = z.object({
  access: videoAccessSchema,
  materialId: videoMaterialIdSchema,
  videoId: videoIdSchema,
}).strict();
export const unselectedUploadInput = z.object({
  materialId: videoMaterialIdSchema,
  selectedVideoId: videoIdSchema.nullable(),
}).strict();
export const presentationInput = z.object({
  materialId: videoMaterialIdSchema,
  videoId: videoIdSchema,
}).strict();
export const readyDurationsInput = z.array(videoIdSchema).max(10_000);
export const progressIdentityInput = z.object({
  accountId: videoAccountIdSchema,
  videoId: videoIdSchema,
}).strict();
export const saveProgressInput = progressIdentityInput.extend({
  durationSeconds: z.number().int().positive(),
  positionSeconds: z.number().int().nonnegative(),
}).refine((value) => value.positionSeconds <= value.durationSeconds);
export const progressManyInput = z.object({ accountId: videoAccountIdSchema, videoIds: z.array(videoIdSchema).max(100) }).strict();
export const accessFactsInput = z.array(videoIdSchema);

export type InitUploadInput = z.output<typeof initInput>;
