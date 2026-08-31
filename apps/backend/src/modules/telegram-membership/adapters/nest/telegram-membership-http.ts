import { createHash, timingSafeEqual } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { z } from "zod";

import type { MembershipEvidenceAcceptance } from "../../../membership-entitlements/index.js";
import type { TelegramLinkResult } from "../../index.js";

export const evidenceDeliveryIdSchema = z.string().trim().min(1).max(256);
export const evidenceSourceSchema = z.enum([
  "link_time",
  "member_status_event",
  "reconciliation",
]);
export const telegramLinkStateSchema = z
  .object({
    deepLink: z.url().optional(),
    expiresAt: z.iso.datetime({ offset: true }),
    linkRef: z.uuid(),
    status: z.enum([
      "conflict",
      "expired",
      "linked",
      "pending",
      "recovery-required",
      "replayed",
      "unavailable",
    ]),
  })
  .strict();
export const evidenceAcceptanceSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      ok: z.literal(true),
      outcome: z.literal("applied"),
      state: z.enum(["active", "non_member"]),
      evidenceVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      outcome: z.literal("accepted_without_entitlement"),
      decision: z.enum([
        "identity_not_linked",
        "identity_conflict",
        "unavailable",
      ]),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      outcome: z.literal("duplicate"),
      evidenceVersion: z.number().int().positive(),
    })
    .strict(),
]);

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

export function throwTelegramLinkError(
  result: Extract<TelegramLinkResult, { readonly ok: false }>,
): never {
  const status = result.error.code === "link_not_found" ? 404 : 400;
  throw problem(status, result.error.code, "Telegram link request failed");
}

export function throwEvidenceError(
  result: Extract<MembershipEvidenceAcceptance, { readonly ok: false }>,
): never {
  const status = evidenceFailureStatus(result.error.code);
  throw problem(status, result.error.code, "Membership evidence was rejected");
}

export function throwInvalidEvidenceRequest(): never {
  throw problem(400, "invalid_evidence", "Membership evidence request is invalid");
}

export function throwEvidenceAuthenticationRequired(): never {
  throw problem(401, "invalid_integration_credential", "Integration authentication failed");
}

function evidenceFailureStatus(
  code: Extract<MembershipEvidenceAcceptance, { readonly ok: false }>["error"]["code"],
): number {
  switch (code) {
    case "unsupported_contract":
    case "invalid_evidence":
      return 400;
    case "expired_evidence":
      return 422;
    case "principal_mismatch":
    case "replayed_evidence":
      return 409;
    case "unavailable":
      return 503;
  }
}

function problem(status: number, code: string, title: string): HttpException {
  return new HttpException(
    {
      code,
      status,
      title,
      type: `urn:inside:problem:telegram-membership:${code.replaceAll("_", "-")}`,
    },
    status,
  );
}
