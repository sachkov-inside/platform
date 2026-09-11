import { z } from "zod";

const revisionCommand = {
  operationId: z.uuid(),
  expectedRevision: z.number().int().positive(),
};
export const revisionCommandSchema = z.strictObject(revisionCommand);
export const resumeInputSchema = z.strictObject({
  ...revisionCommand,
  consentEvidenceRefs: z.array(z.uuid()).min(1).max(4),
});
export const changeQuoteInputSchema = z.strictObject({
  ...revisionCommand,
  paymentOptionId: z.uuid(),
});
export const changeInputSchema = z.strictObject({
  ...revisionCommand,
  changeQuoteRef: z.uuid(),
});
export const revokeMethodInputSchema = z.strictObject({
  ...revisionCommand,
  paymentMethodRef: z.uuid(),
});
export const methodChangeValueSchema = z.object({
  flowRef: z.uuid(),
  formUrl: z.url().nullable(),
  methodRef: z.uuid().nullable(),
  state: z.enum(["started", "completed", "rejected"]),
});

export type RevisionCommand = z.infer<typeof revisionCommandSchema>;
export type ResumeInput = z.infer<typeof resumeInputSchema>;
export type ChangeQuoteInput = z.infer<typeof changeQuoteInputSchema>;
export type ChangeInput = z.infer<typeof changeInputSchema>;
export type RevokeMethodInput = z.infer<typeof revokeMethodInputSchema>;
export type MethodChange = z.infer<typeof methodChangeValueSchema>;
