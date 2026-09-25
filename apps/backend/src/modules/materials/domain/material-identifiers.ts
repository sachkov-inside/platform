export { materialId, type MaterialId } from "../../../infrastructure/contracts/material-id.js";

declare const idempotencyKeyBrand: unique symbol;

export type IdempotencyKey = string & { readonly [idempotencyKeyBrand]: true };

export function materialIdempotencyKey(value: string): IdempotencyKey {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new TypeError("IdempotencyKey must contain 1 to 200 characters");
  }
  // This parser is the single checked constructor for the nominal key brand.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return normalized as IdempotencyKey;
}
