import { z } from "zod";
export const homePinSchema = z
  .object({
    productId: z.uuid().nullable(),
    version: z.number().int().positive(),
  })
  .strict();
