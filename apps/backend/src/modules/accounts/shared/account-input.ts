import { createHmac } from "node:crypto";

import { z } from "zod";

const MAX_SUBJECT_LENGTH = 500;
const MAX_EMAIL_LENGTH = 320;
const FINGERPRINT_VERSION = "v1";

export function validLogtoIdentity(value: {
  readonly issuer: unknown;
  readonly subject: unknown;
}): value is { readonly issuer: string; readonly subject: string } {
  if (
    typeof value.issuer !== "string" ||
    typeof value.subject !== "string" ||
    value.subject.length === 0 ||
    value.subject.length > MAX_SUBJECT_LENGTH
  ) {
    return false;
  }
  try {
    return new URL(value.issuer).protocol === "https:";
  } catch {
    return false;
  }
}

export function fingerprintEmail(email: string, key: string): string | undefined {
  const normalized = normalizeEmail(email);
  if (normalized === undefined) {
    return undefined;
  }
  const digest = createHmac("sha256", key).update(normalized).digest("hex");
  return `${FINGERPRINT_VERSION}:${digest}`;
}

function normalizeEmail(value: string): string | undefined {
  const normalized = value.normalize("NFC").trim().toLocaleLowerCase("en-US");
  const result = z.email().max(MAX_EMAIL_LENGTH).safeParse(normalized);
  return result.success ? result.data : undefined;
}
