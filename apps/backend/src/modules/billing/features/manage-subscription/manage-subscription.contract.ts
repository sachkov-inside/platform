import { z } from "zod";
import { ownAccessGroundSchema } from "../../../membership-entitlements/index.js";
import { idSchema, moneySchema, revisionSchema } from "../../domain/pricing.js";
import { attemptKindSchema, attemptStateSchema } from "../../domain/subscription-change.js";
import { noticeViewSchema } from "../../domain/notice.js";
import { changePlanSchema, subscriptionViewSchema } from "../../domain/subscription-change.js";
import { purchaseStatusSchema } from "../purchase-subscription/purchase-subscription.contract.js";

const command = { operationId: idSchema, expectedRevision: revisionSchema };
export const cancelRenewalSchema = z.strictObject(command);
export const resumeRenewalSchema = z.strictObject({ ...command, consentEvidenceRefs: z.array(idSchema).min(1).max(4) });
export const quoteChangeSchema = z.strictObject({ ...command, paymentOptionId: idSchema });
export const changeOptionSchema = z.strictObject({ ...command, changeQuoteRef: idSchema });
export const cancelChangeSchema = z.strictObject(command);
/**
 * Собственная история списаний покупателя: что списывали, когда и чем это подтверждено.
 * Данные провайдера — терминал, окружение и идентификатор платежа — остаются владельческими.
 */
export const ownPaymentSchema = z.strictObject({
  purchaseRef: idSchema, kind: attemptKindSchema, state: attemptStateSchema,
  amountKopecks: moneySchema, offerName: z.string().min(1).max(200), months: z.int().positive().max(1200),
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(), periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type OwnPayment = z.infer<typeof ownPaymentSchema>;
/**
 * Конверт кабинета: подписка, действующие основания доступа, история списаний и служебные поводы.
 * Путь не меняется — #411 добавляет к нему сводку прав и историю, как предусмотрено контрактом.
 */
export const currentBillingSchema = z.strictObject({
  subscription: subscriptionViewSchema.nullable(), notices: z.array(noticeViewSchema),
  grounds: z.array(ownAccessGroundSchema), payments: z.array(ownPaymentSchema),
});
export const changeQuoteResultSchema = z.strictObject({
  changeQuoteRef: idSchema, baseRevision: revisionSchema, plan: changePlanSchema, expiresAt: z.iso.datetime(),
});
export const changeResultSchema = z.strictObject({
  subscription: subscriptionViewSchema, payment: purchaseStatusSchema.nullable(),
});
export type CurrentBilling = z.infer<typeof currentBillingSchema>;
export type ChangeQuoteResult = z.infer<typeof changeQuoteResultSchema>;
export type ChangeResult = z.infer<typeof changeResultSchema>;
