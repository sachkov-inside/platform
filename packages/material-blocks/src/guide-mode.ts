import { z } from "zod";

/**
 * How a reader goes through a guide. The names match the authoring base, whose variant callouts
 * are `variant-example` and `variant-own`, so an imported step keeps its own branch names and
 * needs no translation table.
 *
 * The list lives beside the rendered-block union rather than inside the block that uses it: the
 * union has to name the same modes, and a second hand-written copy would drift from this one.
 */
export const guideModes = ["example", "own"] as const;

export const guideModeSchema = z.enum(guideModes);

export type GuideMode = z.infer<typeof guideModeSchema>;

/**
 * The name each mode carries for a reader. It lives with the modes because the switch, the hint
 * and the editor all print the same words.
 */
export const guideModeLabels: Readonly<Record<GuideMode, string>> = {
  example: "Учебный проект",
  own: "Свой проект",
};

/** A reader who has never chosen follows the worked example. */
export const defaultGuideMode: GuideMode = "example";

export function isGuideMode(value: unknown): value is GuideMode {
  return guideModeSchema.safeParse(value).success;
}
