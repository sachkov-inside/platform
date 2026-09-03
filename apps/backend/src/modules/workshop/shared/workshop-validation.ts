import { z } from "zod";

export const workshopCaseSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(120);

export const workshopIdempotencyKeySchema = z.string().trim().min(1).max(200);
export const workshopScopeSchema = z.string().trim().min(1).max(128);
