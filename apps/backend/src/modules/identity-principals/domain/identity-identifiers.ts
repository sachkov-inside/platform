import { randomUUID } from "node:crypto";

declare const principalIdBrand: unique symbol;
declare const platformSessionIdBrand: unique symbol;
declare const externalIdentityIdBrand: unique symbol;
declare const reauthenticationAttemptIdBrand: unique symbol;
declare const identityIdempotencyKeyBrand: unique symbol;

export type PrincipalId = string & { readonly [principalIdBrand]: true };
export type PlatformSessionId = string & { readonly [platformSessionIdBrand]: true };
export type ExternalIdentityId = string & { readonly [externalIdentityIdBrand]: true };
export type ReauthenticationAttemptId = string & {
  readonly [reauthenticationAttemptIdBrand]: true;
};
export type IdentityIdempotencyKey = string & {
  readonly [identityIdempotencyKeyBrand]: true;
};

export function parsePrincipalId(value: unknown): PrincipalId | undefined {
  // This parser is the single checked constructor for the nominal ID brand.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return isUuid(value) ? (value as PrincipalId) : undefined;
}

export function parsePlatformSessionId(value: unknown): PlatformSessionId | undefined {
  // This parser is the single checked constructor for the nominal ID brand.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return isUuid(value) ? (value as PlatformSessionId) : undefined;
}

export function parseReauthenticationAttemptId(
  value: unknown,
): ReauthenticationAttemptId | undefined {
  // This parser is the single checked constructor for the nominal ID brand.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return isUuid(value) ? (value as ReauthenticationAttemptId) : undefined;
}

export function parseIdentityIdempotencyKey(
  value: unknown,
): IdentityIdempotencyKey | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    return undefined;
  }
  // This parser is the single checked constructor for the nominal key brand.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return value as IdentityIdempotencyKey;
}

export function newPrincipalId(): PrincipalId {
  // randomUUID is the checked source for this nominal ID brand.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return randomUUID() as PrincipalId;
}

export function newPlatformSessionId(): PlatformSessionId {
  // randomUUID is the checked source for this nominal ID brand.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return randomUUID() as PlatformSessionId;
}

export function newExternalIdentityId(): ExternalIdentityId {
  // randomUUID is the checked source for this nominal ID brand.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return randomUUID() as ExternalIdentityId;
}

export function newReauthenticationAttemptId(): ReauthenticationAttemptId {
  // randomUUID is the checked source for this nominal ID brand.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return randomUUID() as ReauthenticationAttemptId;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
