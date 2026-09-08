import { z } from "zod";
export const homePinSchema = z.object({ materialId: z.uuid().nullable(), version: z.number().int().positive() }).strict();
