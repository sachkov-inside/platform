import { coverageEntrySchema } from "@inside/access-capabilities";
import { z } from "zod";

export const contentCatalogInputSchema = z.object({ operationId: z.uuid() });
export const contentCatalogOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("content"),
    items: z.array(coverageEntrySchema),
  }),
});
