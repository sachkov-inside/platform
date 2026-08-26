import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

interface ExpiringPayload {
  readonly expiresAt: string;
}

export function encodeSignedCookie(
  payload: ExpiringPayload,
  secret: string,
): string {
  validateSecret(secret);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function decodeSignedCookie<T extends ExpiringPayload>(
  value: string,
  secret: string,
  isPayload: (value: unknown) => value is T,
  now = new Date(),
): T | undefined {
  try {
    validateSecret(secret);
    const separator = value.indexOf(".");
    if (separator <= 0 || value.includes(".", separator + 1)) {
      return undefined;
    }
    const encoded = value.slice(0, separator);
    const actual = Buffer.from(value.slice(separator + 1), "base64url");
    const expected = Buffer.from(signature(encoded, secret), "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (!isPayload(parsed) || Date.parse(parsed.expiresAt) <= now.getTime()) {
      return undefined;
    }
    return Object.freeze(parsed);
  } catch {
    return undefined;
  }
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function validateSecret(secret: string): void {
  if (secret.length < 32) {
    throw new TypeError("LOGTO_COOKIE_SECRET must contain at least 32 characters");
  }
}
