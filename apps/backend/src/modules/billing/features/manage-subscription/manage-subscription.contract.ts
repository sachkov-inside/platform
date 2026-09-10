import { z } from "zod";
import { idSchema, revisionSchema } from "../../domain/pricing.js";
import { noticeViewSchema } from "../../domain/notice.js";
import { changePlanSchema, subscriptionViewSchema } from "../../domain/subscription-change.js";
import { purchaseStatusSchema } from "../purchase-subscription/purchase-subscription.contract.js";

const command = { operationId: idSchema, expectedRevision: revisionSchema };
export const cancelRenewalSchema = z.strictObject(command);
export const resumeRenewalSchema = z.strictObject({ ...command, consentEvidenceRefs: z.array(idSchema).min(1).max(4) });
export const quoteChangeSchema = z.strictObject({ ...command, paymentOptionId: idSchema });
export const changeOptionSchema = z.strictObject({ ...command, changeQuoteRef: idSchema });
export const cancelChangeSchema = z.strictObject(command);
export const currentBillingSchema = z.strictObject({
  subscription: subscriptionViewSchema.nullable(), notices: z.array(noticeViewSchema),
});
export const changeQuoteResultSchema = z.strictObject({
  changeQuoteRef: idSchema, baseRevision: revisionSchema, plan: changePlanSchema, expiresAt: z.iso.datetime(),
});
export const changeResultSchema = z.strictObject({
  subscription: subscriptionViewSchema, payment: purchaseStatusSchema.nullable(),
});
export type ChangeQuoteResult = z.infer<typeof changeQuoteResultSchema>;
export type ChangeResult = z.infer<typeof changeResultSchema>;
