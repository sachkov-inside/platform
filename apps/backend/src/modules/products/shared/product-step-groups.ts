import { z } from "zod";

/** Labels are exact after trimming; length is measured in UTF-16 code units. */
export const productStepGroupSchema = z.string().trim().min(1).max(120);
export const productStepGroupsSchema = z.record(
  z.uuid(),
  productStepGroupSchema,
);
