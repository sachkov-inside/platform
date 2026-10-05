declare const truthyValue: unique symbol;

/** A checked truthy value; the brand keeps the false branch from excluding 0 or "" by type. */
export function isTruthy<T>(value: T): value is Exclude<
  T,
  false | 0 | "" | null | undefined
> & {
  readonly [truthyValue]: true;
} {
  return Boolean(value);
}
