import { z } from "zod";

/** Screen on which a person pressed the accepting button. */
export const acceptanceScreenSchema = z.enum([
  "first-sign-in",
  "checkout",
  "subscription-resume",
]);
export type AcceptanceScreen = z.infer<typeof acceptanceScreenSchema>;

/** Label of the pressed button exactly as the person saw it. */
export const buttonLabelSchema = z.string().trim().min(1).max(200);

/**
 * Renewal terms shown next to a subscription button: the amount and day of the next charge and the
 * period that repeats it. The journal keeps what the page showed; billing does not re-derive them.
 */
export const shownRenewalTermsSchema = z.strictObject({
  amountKopecks: z.number().int().positive().max(100_000_000),
  nextChargeOn: z.iso.date(),
  periodMonths: z.number().int().positive().max(120),
});
export type ShownRenewalTerms = z.infer<typeof shownRenewalTermsSchema>;

/** The terms of use edition a first sign-in accepts, addressed by its permanent page. */
export const termsDocumentSchema = z.strictObject({
  documentId: z.literal("terms"),
  version: z.string().min(1).max(100),
  digest: z.string().length(64),
  url: z.url(),
});
export type TermsDocument = z.infer<typeof termsDocumentSchema>;

export const acceptTermsSchema = z.strictObject({
  operationId: z.uuid(),
  version: z.string().min(1).max(100),
  digest: z.string().length(64),
  buttonLabel: buttonLabelSchema,
});

export const legalAcceptanceErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "invalid_input",
      "forbidden",
      "document_changed",
      "operation_conflict",
      "internal_error",
    ]),
  }),
});
export type LegalAcceptanceError = z.infer<typeof legalAcceptanceErrorSchema>;
export const legalAcceptanceFailure = (
  code: LegalAcceptanceError["error"]["code"],
): LegalAcceptanceError => ({ ok: false, error: { code } });

export const readTermsStatusResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    /** The edition in force is accepted: the cabinet, purchases and the bot link are open. */
    accepted: z.boolean(),
    /** An earlier edition was accepted, so the screen says the terms changed. */
    previouslyAccepted: z.boolean(),
    document: termsDocumentSchema,
  }),
  legalAcceptanceErrorSchema,
]);
export type ReadTermsStatusResult = z.infer<typeof readTermsStatusResultSchema>;

export const acceptTermsResultSchema = z.union([
  z.object({ ok: z.literal(true), acceptanceRef: z.uuid() }),
  legalAcceptanceErrorSchema,
]);
export type AcceptTermsResult = z.infer<typeof acceptTermsResultSchema>;

/** One row of the journal as its owner sees it in the cabinet. */
export const acceptedDocumentSchema = z.object({
  acceptanceRef: z.uuid(),
  documentId: z.string(),
  version: z.string(),
  url: z.url(),
  acceptedAt: z.iso.datetime(),
  /** Absent only on acceptances recorded before the journal named screens and buttons. */
  screen: acceptanceScreenSchema.nullable(),
  buttonLabel: z.string().nullable(),
  shownTerms: shownRenewalTermsSchema.nullable(),
});
export type AcceptedDocument = z.infer<typeof acceptedDocumentSchema>;

export const listAcceptedDocumentsResultSchema = z.union([
  z.object({ ok: z.literal(true), documents: z.array(acceptedDocumentSchema) }),
  legalAcceptanceErrorSchema,
]);
export type ListAcceptedDocumentsResult = z.infer<
  typeof listAcceptedDocumentsResultSchema
>;

/** Whether the edition in force is accepted; the gate of the cabinet, purchases and the bot link. */
export type TermsAcceptanceCheck =
  | { readonly ok: true; readonly accepted: boolean }
  | LegalAcceptanceError;
