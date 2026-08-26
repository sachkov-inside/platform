import { createHash } from "node:crypto";

import type {
  PlatformPermission,
  VerifiedSessionIdentity,
} from "../facets/identity-principals/identity-principals.interface.js";

export function validIdentityKey(identity: {
  readonly issuer: string;
  readonly subject: string;
}): boolean {
  try {
    const issuer = new URL(identity.issuer);
    return (
      issuer.protocol === "https:" &&
      issuer.toString() === identity.issuer &&
      identity.subject.length > 0 &&
      identity.subject.length <= 500
    );
  } catch {
    return false;
  }
}

export function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function fingerprintCommand(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function identityKind(identity: VerifiedSessionIdentity): "human" | "service" {
  return identity.type === "human_session" ? "human" : "service";
}

export function isPlatformPermission(value: string): value is PlatformPermission {
  switch (value) {
    case "identity:admin":
    case "materials:author":
    case "materials:publish":
      return true;
    default:
      return false;
  }
}
