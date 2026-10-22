/**
 * A sort comparator that orders strings by their UTF-16 code units, independent of any database
 * collation. It equals code-point order for every string without surrogate pairs.
 */
export function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
