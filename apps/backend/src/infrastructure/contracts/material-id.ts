import { z } from "zod";

const materialIdSchema = z
  .uuid()
  .transform((value) => value.toLowerCase())
  .brand<"MaterialId">();

/**
 * The checked identifier of one Material. Materials owns Materials; the brand lives here, below
 * every Module, so Content Access and Workshop can name a Material without depending on Materials.
 */
export type MaterialId = z.output<typeof materialIdSchema>;

export function materialId(value: string): MaterialId {
  const parsed = materialIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("MaterialId must be a UUID");
  }
  return parsed.data;
}
