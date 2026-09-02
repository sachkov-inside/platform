import { randomUUID } from "node:crypto";

import { z } from "zod";

export const videoAccountIdSchema = z.uuid().brand<"VideoAccountId">();
export const videoMaterialIdSchema = z.uuid().brand<"VideoMaterialId">();
export const videoIdSchema = z.uuid().brand<"VideoId">();
export const videoUploadAttemptIdSchema = z.uuid().brand<"VideoUploadAttemptId">();
export const videoDeletionOperationIdSchema = z.uuid().brand<"VideoDeletionOperationId">();
export const videoWebhookInboxIdSchema = z.uuid().brand<"VideoWebhookInboxId">();
export const videoIdempotencyKeySchema = z.string().trim().min(1).max(128).brand<"VideoIdempotencyKey">();
export const providerVideoIdSchema = z.string().trim().min(1).max(256).brand<"ProviderVideoId">();

export type VideoAccountId = z.output<typeof videoAccountIdSchema>;
export type VideoMaterialId = z.output<typeof videoMaterialIdSchema>;
export type VideoId = z.output<typeof videoIdSchema>;
export type VideoUploadAttemptId = z.output<typeof videoUploadAttemptIdSchema>;
export type VideoDeletionOperationId = z.output<typeof videoDeletionOperationIdSchema>;
export type ProviderVideoId = z.output<typeof providerVideoIdSchema>;

export function newVideoId(): VideoId {
  return videoIdSchema.parse(randomUUID());
}

export function newVideoUploadAttemptId(): VideoUploadAttemptId {
  return videoUploadAttemptIdSchema.parse(randomUUID());
}

export function newVideoDeletionOperationId(): VideoDeletionOperationId {
  return videoDeletionOperationIdSchema.parse(randomUUID());
}

export function newVideoWebhookInboxId(): z.output<typeof videoWebhookInboxIdSchema> {
  return videoWebhookInboxIdSchema.parse(randomUUID());
}
