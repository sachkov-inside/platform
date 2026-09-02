import { z } from "zod";

export const authoringVideoSchema = z.object({
  failureCode: z.string().optional(),
  origin: z.enum(["external_attachment", "platform_upload"]),
  state: z.enum([
    "uploading",
    "processing",
    "ready",
    "failed",
    "deletion_requested",
    "deleting",
    "deleted",
    "delete_failed",
  ]),
  title: z.string(),
  videoId: z.uuid(),
}).strict();

export const videoSchema = authoringVideoSchema.extend({
  access: z.enum(["free", "membership"]),
  materialId: z.uuid(),
}).strict();

export type MaterialAuthoringVideo = z.infer<typeof authoringVideoSchema>;
export type MaterialVideo = z.infer<typeof videoSchema>;
