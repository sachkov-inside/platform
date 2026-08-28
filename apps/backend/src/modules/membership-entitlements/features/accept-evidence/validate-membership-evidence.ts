import { z } from "zod";

const CONTRACT_VERSION = "inside.membership-evidence.v1";
const MAX_EVIDENCE_VALIDITY_MS = 5 * 60 * 1_000;

const principalRefSchema = z
  .string()
  .min(1)
  .max(256)
  .brand<"MembershipPrincipalRef">();
const telegramIdentityRefSchema = z
  .string()
  .min(1)
  .max(256)
  .brand<"TelegramIdentityRef">();
const evidenceRefSchema = z
  .string()
  .min(1)
  .max(256)
  .brand<"MembershipEvidenceRef">();
const observedEvidenceBase = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    principalRef: principalRefSchema,
    checkedAt: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
    telegramIdentityRef: telegramIdentityRefSchema,
    evidenceRef: evidenceRefSchema,
    evidenceVersion: z.number().int().positive(),
  })
  .strict();

const membershipEvidenceSchema = z.discriminatedUnion("decision", [
  observedEvidenceBase.extend({
    decision: z.literal("member"),
    reasonCode: z.literal("chat_member"),
  }),
  observedEvidenceBase.extend({
    decision: z.literal("not_member"),
    reasonCode: z.literal("chat_not_member"),
  }),
  z
    .object({
      contractVersion: z.literal(CONTRACT_VERSION),
      principalRef: principalRefSchema,
      decision: z.literal("identity_not_linked"),
      reasonCode: z.literal("identity_not_linked"),
    })
    .strict(),
  z
    .object({
      contractVersion: z.literal(CONTRACT_VERSION),
      principalRef: principalRefSchema,
      decision: z.literal("identity_conflict"),
      reasonCode: z.literal("identity_conflict"),
      telegramIdentityRef: telegramIdentityRefSchema.optional(),
    })
    .strict(),
  z
    .object({
      contractVersion: z.literal(CONTRACT_VERSION),
      principalRef: principalRefSchema,
      decision: z.literal("unavailable"),
      reasonCode: z.literal("provider_unavailable"),
      telegramIdentityRef: telegramIdentityRefSchema.optional(),
    })
    .strict(),
]);

export type MembershipEvidence = z.infer<typeof membershipEvidenceSchema>;
export type ObservedMembershipEvidence = Extract<
  MembershipEvidence,
  { readonly decision: "member" | "not_member" }
>;

export type MembershipEvidenceValidation =
  | Readonly<{ ok: true; value: MembershipEvidence }>
  | Readonly<{
      ok: false;
      error: {
        readonly code:
          | "unsupported_contract"
          | "invalid_evidence"
          | "expired_evidence";
      };
    }>;

export function validateMembershipEvidence(
  input: unknown,
  now: Date,
): MembershipEvidenceValidation {
  if (
    typeof input !== "object" ||
    input === null ||
    !("contractVersion" in input) ||
    input.contractVersion !== CONTRACT_VERSION
  ) {
    return { ok: false, error: { code: "unsupported_contract" } };
  }

  const parsed = membershipEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_evidence" } };
  }
  if (
    parsed.data.decision !== "member" &&
    parsed.data.decision !== "not_member"
  ) {
    return { ok: true, value: parsed.data };
  }

  const checkedAt = new Date(parsed.data.checkedAt);
  const validUntil = new Date(parsed.data.validUntil);
  const validity = validUntil.getTime() - checkedAt.getTime();
  if (
    checkedAt.getTime() > now.getTime() ||
    validity <= 0 ||
    validity > MAX_EVIDENCE_VALIDITY_MS
  ) {
    return { ok: false, error: { code: "invalid_evidence" } };
  }
  if (validUntil.getTime() <= now.getTime()) {
    return { ok: false, error: { code: "expired_evidence" } };
  }
  return { ok: true, value: parsed.data };
}
