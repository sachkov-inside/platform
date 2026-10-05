declare const nonEmptyText: unique symbol;

/** A string known to have at least one character. */
export type NonEmptyText = string & { readonly [nonEmptyText]: true };

/**
 * A string with at least one character. `null`, `undefined` and the empty string are absent, exactly
 * as a truthiness check treated them, so this names that intent under `strict-boolean-expressions`.
 * The brand keeps the check sound: a failed check leaves `string` in the type, since "" is one.
 */
export function hasText(
  value: string | null | undefined,
): value is NonEmptyText {
  return value !== undefined && value !== null && value !== "";
}

/** The value when it `hasText`, otherwise undefined: the text form of `value || fallback`. */
export function presentText(
  value: string | null | undefined,
): NonEmptyText | undefined {
  return hasText(value) ? value : undefined;
}
