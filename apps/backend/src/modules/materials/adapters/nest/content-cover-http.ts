import { z } from "zod";

export const contentCoverProjectionHttpSchema = z
  .object({
    coverId: z.uuid(),
    renditions: z.array(
      z
        .object({
          height: z.number().int().positive(),
          width: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
