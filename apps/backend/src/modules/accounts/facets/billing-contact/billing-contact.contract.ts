import { paymentModes } from "@inside/legal";
import { z } from "zod";
export const billingEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const contactRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(2_147_483_646);
export const startContactSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: contactRevisionSchema,
  email: billingEmailSchema,
});
export const confirmContactSchema = z.strictObject({
  operationId: z.uuid(),
  challengeRef: z.uuid(),
  code: z.string().regex(/^[0-9]{6}$/u),
});
export const consentKindSchema = z.enum([
  "terms",
  "recurring",
  "personal_data",
  "marketing",
]);
/**
 * A one-time guide purchase and a subscription are separate offers, so the applicable document of
 * one kind differs between them. The catalogue says which payment modes a document belongs to;
 * the buyer's own mode selects it.
 */
export const consentPaymentModeSchema = z.enum(paymentModes);
export const legalDocumentSchema = z.strictObject({
  kind: consentKindSchema,
  appliesTo: z
    .array(consentPaymentModeSchema)
    .min(1)
    .max(paymentModes.length)
    .readonly(),
  documentId: z.string().min(1).max(100),
  version: z.string().min(1).max(100),
  text: z.string().min(1).max(100_000),
  url: z.url(),
  digest: z.string().length(64),
});
export type LegalDocument = z.infer<typeof legalDocumentSchema>;
export const acceptConsentsSchema = z.strictObject({
  operationId: z.uuid(),
  contextRef: z.uuid(),
  documents: z
    .array(
      z.strictObject({
        kind: consentKindSchema,
        documentId: z.string().min(1).max(100),
        version: z.string().min(1).max(100),
        digest: z.string().length(64),
        accepted: z.literal(true),
      }),
    )
    .min(1)
    .max(4),
});
export const contactSchema = z.object({
  email: billingEmailSchema,
  revision: contactRevisionSchema,
  verifiedAt: z.iso.datetime(),
});
export const contactErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "invalid_input",
      "forbidden",
      "revision_conflict",
      "operation_conflict",
      "rate_limited",
      "challenge_invalid",
      "contact_required",
      "document_changed",
      "not_found",
      "provider_unavailable",
      "internal_error",
    ]),
  }),
});
export const startContactResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    challengeRef: z.uuid(),
    expiresAt: z.iso.datetime(),
    delivery: z.enum(["sent", "unknown"]),
  }),
  contactErrorSchema,
]);
export const confirmContactResultSchema = z.union([
  z.object({ ok: z.literal(true), revision: contactRevisionSchema }),
  contactErrorSchema,
]);
export const acceptConsentsResultSchema = z.union([
  z.object({ ok: z.literal(true), evidenceRefs: z.array(z.uuid()) }),
  contactErrorSchema,
]);
export const readContactResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    contact: contactSchema.nullable(),
    documents: z.array(legalDocumentSchema),
  }),
  contactErrorSchema,
]);
export type ContactError = z.infer<typeof contactErrorSchema>;
export type StartContactResult = z.infer<typeof startContactResultSchema>;
export type ConfirmContactResult = z.infer<typeof confirmContactResultSchema>;
export type AcceptConsentsResult = z.infer<typeof acceptConsentsResultSchema>;
export type ReadContactResult = z.infer<typeof readContactResultSchema>;
export const contactFailure = (
  code: ContactError["error"]["code"],
): ContactError => ({ ok: false, error: { code } });

/**
 * Документ в сохранённом доказательстве: ровно то, что человек принял. К каким продажам документ
 * предлагается сегодня, доказательством не является, хранится только в каталоге и поэтому здесь
 * отсутствует: иначе прежнее доказательство переставало бы читаться при изменении каталога.
 */
export const acceptedLegalDocumentSchema = legalDocumentSchema.omit({
  appliesTo: true,
});
export type AcceptedLegalDocument = z.infer<typeof acceptedLegalDocumentSchema>;
export const consentEvidenceSchema = z.object({
  evidenceRef: z.uuid(),
  contextRef: z.uuid(),
  acceptedAt: z.iso.datetime(),
  document: acceptedLegalDocumentSchema,
});
export const readConsentResultSchema = z.union([
  z.object({ ok: z.literal(true), evidence: consentEvidenceSchema }),
  contactErrorSchema,
]);
export type ReadConsentResult = z.infer<typeof readConsentResultSchema>;
