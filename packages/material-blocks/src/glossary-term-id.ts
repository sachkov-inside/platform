import { z } from "zod";

/**
 * The permanent identifier of a Glossary Term: a lowercase kebab-case slug, the same spelling the
 * author writes in `term:<id>`. It never changes when the term is renamed.
 */
export const glossaryTermIdSchema: z.ZodString = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
