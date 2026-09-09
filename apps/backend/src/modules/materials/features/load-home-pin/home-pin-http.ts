import { z } from "zod";
export const homePinSchema = z.object({ seriesId: z.uuid().nullable(), version: z.number().int().positive() }).strict();
