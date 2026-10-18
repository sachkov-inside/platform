import { z } from "zod";
import { reviewReportSchema } from "./review-report.js";

/** Agent statements about a review, never a submission or an author's assessment. */
export const reviewProgressSchema = z
  .object({
    taskVersion: z.number().int().positive(),
    runKey: z.uuid(),
    revision: z.number().int().positive(),
    phase: z.enum(["reviewing", "ready", "stopped", "submitted"]),
    summary: z.string().min(1).max(1000),
    reviewReport: reviewReportSchema.nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type ReviewProgress = z.infer<typeof reviewProgressSchema>;
