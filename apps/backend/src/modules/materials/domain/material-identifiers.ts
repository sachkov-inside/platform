declare const materialIdBrand: unique symbol;
declare const materialRevisionIdBrand: unique symbol;
declare const idempotencyKeyBrand: unique symbol;

export type MaterialId = string & { readonly [materialIdBrand]: true };
export type MaterialRevisionId = string & {
  readonly [materialRevisionIdBrand]: true;
};
export type IdempotencyKey = string & { readonly [idempotencyKeyBrand]: true };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function materialId(value: string): MaterialId {
  if (!uuidPattern.test(value)) {
    throw new TypeError("MaterialId must be a UUID");
  }
  return value.toLowerCase() as MaterialId;
}

export function materialRevisionId(value: string): MaterialRevisionId {
  if (!uuidPattern.test(value)) {
    throw new TypeError("MaterialRevisionId must be a UUID");
  }
  return value.toLowerCase() as MaterialRevisionId;
}

export function materialIdempotencyKey(value: string): IdempotencyKey {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new TypeError("IdempotencyKey must contain 1 to 200 characters");
  }
  return normalized as IdempotencyKey;
}
