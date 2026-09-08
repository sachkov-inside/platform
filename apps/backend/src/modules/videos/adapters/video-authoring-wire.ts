import { z } from "zod";
import { videoAccessSchema } from "../facets/videos/videos.interface.js";

export const videoUploadBodySchema = z.object({
  access: videoAccessSchema,
  byteSize: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
  filename: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
}).strict();
export const videoAttachmentBodySchema = z.object({
  access: videoAccessSchema,
  providerVideoId: z.string().min(1).max(256),
}).strict();
