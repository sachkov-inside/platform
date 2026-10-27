import { z } from "zod";

import { problemException } from "../../../../infrastructure/http/problem-details.js";

import type { TelegramLinkResult } from "../../facets/telegram-membership/telegram-membership.interface.js";

export const telegramMembershipProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
  })
  .strict();
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
const accountLinkRetrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm"), linkRef: z.uuid() }).strict(),
  z.object({ kind: z.literal("refresh") }).strict(),
]);
const accountLinkRecoverySchema = z
  .object({ kind: z.literal("support"), url: z.url().optional() })
  .strict();
const accountTelegramLinkStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unlinked") }).strict(),
  z
    .object({
      expiresAt: z.iso.datetime({ offset: true }),
      kind: z.literal("linking"),
      linkRef: z.uuid(),
    })
    .strict(),
  z.object({ kind: z.literal("linked") }).strict(),
  z
    .object({ kind: z.literal("conflict"), supportUrl: z.url().optional() })
    .strict(),
  z
    .object({
      kind: z.literal("retryable"),
      reason: z.enum(["expired", "replayed"]),
    })
    .strict(),
  z
    .object({ kind: z.literal("unavailable"), retry: accountLinkRetrySchema })
    .strict(),
  z
    .object({
      kind: z.literal("recovery-required"),
      recovery: accountLinkRecoverySchema,
    })
    .strict(),
]);
const accountMembershipStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active") }).strict(),
  z.object({ kind: z.literal("inactive") }).strict(),
  z.object({ kind: z.literal("stale") }).strict(),
  z.object({ kind: z.literal("notOffered") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);
export const accountTelegramMembershipPresentationSchema = z
  .object({
    link: accountTelegramLinkStateSchema,
    membership: accountMembershipStateSchema,
    contact: z
      .object({
        state: z.enum(["available", "not_linked", "unavailable"]),
        displayName: z.string().nullable(),
        username: z.string().nullable(),
      })
      .strict(),
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

export function throwTelegramLinkError(
  result: Extract<TelegramLinkResult, { readonly ok: false }>,
): never {
  const status = telegramLinkFailureStatus(result.error.code);
  throw problemException(
    status,
    result.error.code,
    "Telegram link request failed",
  );
}

export function throwTelegramAccountPresentationError(): never {
  throw problemException(
    503,
    "unavailable",
    "Account Membership presentation is unavailable",
  );
}

function telegramLinkFailureStatus(
  code: Extract<TelegramLinkResult, { readonly ok: false }>["error"]["code"],
): number {
  switch (code) {
    case "invalid_input":
      return 400;
    case "link_not_found":
      return 404;
    case "unavailable":
      return 503;
  }
}

export {
  bearerCredential,
  credentialsMatch,
} from "../../../../infrastructure/http/bearer-credentials.js";
