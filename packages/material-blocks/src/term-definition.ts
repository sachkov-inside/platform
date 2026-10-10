import { z } from "zod";

/** Authored card data, independent of any Material body or local vault path. */
export const termDefinitionSchema: z.ZodObject<{
  id: z.ZodUUID;
  title: z.ZodString;
  aliases: z.ZodArray<z.ZodString>;
  definition: z.ZodString;
  example: z.ZodOptional<z.ZodString>;
  materialId: z.ZodOptional<z.ZodUUID>;
}> = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(200),
    aliases: z.array(z.string().trim().min(1).max(200)).max(50),
    definition: z.string().trim().min(1).max(2000),
    example: z.string().trim().min(1).max(1000).optional(),
    materialId: z.uuid().optional(),
  })
  .strict();

export type TermDefinition = z.infer<typeof termDefinitionSchema>;
