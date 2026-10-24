import { z } from "zod";

/** Labels are exact after trimming; length is measured in UTF-16 code units. */
export const seriesStepGroupSchema = z.string().trim().min(1).max(120);
export const seriesStepGroupsSchema = z.record(z.uuid(), seriesStepGroupSchema);
