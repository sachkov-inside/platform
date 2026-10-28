import { z } from "zod";

/** The longest text an author searches the authoring corpus by. */
export const AUTHORING_SEARCH_MAX_CHARACTERS = 160;

/**
 * The text an author searches by: trimmed, 1–160 characters, whitespace runs collapsed to one
 * space. The Materials list and the authoring search read it the same way.
 */
export const authoringSearchTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(AUTHORING_SEARCH_MAX_CHARACTERS)
  .transform((value) => value.replace(/\s+/gu, " "));

/** A Material matches when its title, summary or slug contains the text, ignoring case. */
export function authoringMaterialSearchWhere(search: string) {
  return {
    OR: [
      { title: { contains: search, mode: "insensitive" as const } },
      { summary: { contains: search, mode: "insensitive" as const } },
      { slug: { contains: search, mode: "insensitive" as const } },
    ],
  };
}
