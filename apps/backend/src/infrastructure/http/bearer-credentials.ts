import { createHash, timingSafeEqual } from "node:crypto";

export function bearerCredential(
  authorization: string | undefined,
): string | undefined {
  const prefix = "Bearer ";
  return authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : undefined;
}

export function credentialsMatch(
  received: string | undefined,
  expected: string,
): boolean {
  if (received === undefined) {
    return false;
  }
  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

