import { z } from "zod";

/** The longest people search text, counted after trimming. */
export const PERSON_SEARCH_QUERY_MAX_CHARACTERS = 160;

/**
 * What one people search text asks for (#1721): an Account ID, an exact email address, or a name
 * or @username, which only the Telegram application can search.
 */
export type PersonSearchTerm =
  | { readonly kind: "account_id"; readonly accountId: string }
  | { readonly kind: "email"; readonly email: string }
  | { readonly kind: "name"; readonly text: string };

const searchTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(PERSON_SEARCH_QUERY_MAX_CHARACTERS)
  .transform((value) => value.replace(/\s+/gu, " "));

/** Text that is not 1–160 characters after trimming is no term. */
export function parsePersonSearchTerm(
  input: unknown,
): PersonSearchTerm | undefined {
  const text = searchTextSchema.safeParse(input);
  if (!text.success) return undefined;
  const value = text.data;
  if (z.uuid().safeParse(value).success)
    return { kind: "account_id", accountId: value.toLowerCase() };
  // «@username» starts with the sign; an address has text on both sides of it.
  if (!value.startsWith("@") && z.email().safeParse(value).success)
    return { kind: "email", email: value };
  return { kind: "name", text: value };
}
