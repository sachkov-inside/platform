import { normalizedUuidSchema } from "./uuid.js";

declare const materialIdBrand: unique symbol;
declare const materialRevisionIdBrand: unique symbol;
declare const idempotencyKeyBrand: unique symbol;

export type MaterialId = string & { readonly [materialIdBrand]: true };
export type MaterialRevisionId = string & {
  readonly [materialRevisionIdBrand]: true;
};
export type IdempotencyKey = string & { readonly [idempotencyKeyBrand]: true };

function normalizedIdentifier(value: string, name: string): string {
  const parsed = normalizedUuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`${name} must be a UUID`);
  }
  return parsed.data;
}

export function materialId(value: string): MaterialId {
  return normalizedIdentifier(value, "MaterialId") as MaterialId;
}

export function materialRevisionId(value: string): MaterialRevisionId {
  return normalizedIdentifier(value, "MaterialRevisionId") as MaterialRevisionId;
}

export function materialIdempotencyKey(value: string): IdempotencyKey {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new TypeError("IdempotencyKey must contain 1 to 200 characters");
  }
  return normalized as IdempotencyKey;
}
