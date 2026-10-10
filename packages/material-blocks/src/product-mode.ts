import { z } from "zod";

/**
 * How a reader goes through a product. The names match the authoring base, whose variant callouts
 * are `variant-example` and `variant-own`, so an imported step keeps its own branch names and
 * needs no translation table.
 *
 * The list lives beside the rendered-block union rather than inside the block that uses it: the
 * union has to name the same modes, and a second hand-written copy would drift from this one.
 */
export const productModes = ["example", "own"] as const;

export const productModeSchema: z.ZodEnum<
  z.core.util.ToEnum<(typeof productModes)[number]>
> = z.enum(productModes);

export type ProductMode = z.infer<typeof productModeSchema>;

/**
 * The name each mode carries for a reader. It lives with the modes because the switch, the hint
 * and the editor all print the same words.
 */
export const productModeLabels: Readonly<Record<ProductMode, string>> = {
  example: "Учебный проект",
  own: "Свой проект",
};

/** A reader who has never chosen follows the worked example. */
export const defaultProductMode: ProductMode = "example";

export function isProductMode(value: unknown): value is ProductMode {
  return productModeSchema.safeParse(value).success;
}
