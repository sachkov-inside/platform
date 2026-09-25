import { z } from "zod";

declare const materialIdBrand: unique symbol;

/**
 * The checked identifier of one Material. Materials owns Materials; the brand lives here, below
 * every Module, so Content Access and Workshop can name a Material without depending on Materials.
 */
export type MaterialId = string & { readonly [materialIdBrand]: true };

const materialIdSchema = z.uuid().transform((value) => value.toLowerCase());

export function materialId(value: string): MaterialId {
  const parsed = materialIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("MaterialId must be a UUID");
  }
  // This parser is the single checked constructor for the nominal ID brand.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parsed.data as MaterialId;
}
