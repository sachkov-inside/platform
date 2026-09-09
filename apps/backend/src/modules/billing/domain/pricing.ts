import { z } from "zod";
import { accessCapabilitySchema, capabilitiesSchema } from "../../membership-entitlements/index.js";

export const idSchema = z.uuid().toLowerCase();
export const revisionSchema = z.int().positive().max(2_147_483_647);
export const moneySchema = z.int().positive();
export const benefitsSchema = capabilitiesSchema;
export const benefitPeriodsSchema = z.array(z.strictObject({
  capability: accessCapabilitySchema,
  months: z.int().positive().max(1200).nullable(),
})).max(100);
export const offerSchema = z.strictObject({
  id: idSchema, revision: revisionSchema, name: z.string().trim().min(1).max(200),
  benefits: benefitsSchema, benefitPeriods: benefitPeriodsSchema.optional(), archived: z.boolean(),
});
export const optionSchema = z.strictObject({
  id: idSchema, revision: revisionSchema, offerId: idSchema,
  mode: z.literal("subscription").optional(),
  months: revisionSchema.max(1200), priceKopecks: moneySchema, archived: z.boolean(),
});
export const promotionSchema = z.strictObject({
  id: idSchema, revision: revisionSchema, name: z.string().trim().min(1).max(200),
  percent: z.int().min(1).max(100), code: z.string().trim().min(1).max(100).nullable(),
  startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }),
  offerIds: z.array(idSchema).max(100), paymentOptionIds: z.array(idSchema).max(100),
  usageLimit: revisionSchema.nullable(), archived: z.boolean(),
});
export const priceSnapshotSchema = z.strictObject({
  offer: offerSchema, paymentOption: optionSchema,
  promotion: z.strictObject({ id: idSchema, revision: revisionSchema, name: z.string(), percent: z.int().min(1).max(100) }).nullable(),
  currency: z.literal("RUB"), timezone: z.literal("Europe/Moscow"),
  firstPriceKopecks: moneySchema, renewalPriceKopecks: moneySchema,
});
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;
export type Promotion = z.infer<typeof promotionSchema>;
export type Offer = z.infer<typeof offerSchema>;
export type PaymentOption = z.infer<typeof optionSchema>;
export type PricingError = { readonly code:
  | "invalid_request" | "forbidden" | "not_found" | "revision_conflict" | "operation_conflict"
  | "quote_changed" | "quote_expired" | "unsupported_amount" | "reservation_conflict" | "dependency_unavailable"
};
export type PricingResult<T, Code extends PricingError["code"] = PricingError["code"]> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: Code } };
export const failure = <const Code extends PricingError["code"]>(code: Code): { readonly ok: false; readonly error: { readonly code: Code } } => ({ ok: false, error: { code } });

export function discountedPrice(price: number, percent: number): number {
  // Round the final price once, half a kopeck up, with no floating-point arithmetic.
  return Number((BigInt(price) * BigInt(100 - percent) + 50n) / 100n);
}
export function applicablePromotion(promotion: Promotion, option: PaymentOption, now: Date, code?: string): boolean {
  return !promotion.archived && Date.parse(promotion.startsAt) <= now.getTime() && now.getTime() < Date.parse(promotion.endsAt)
    && (promotion.code === null || promotion.code === code)
    && (promotion.offerIds.length === 0 || promotion.offerIds.includes(option.offerId))
    && (promotion.paymentOptionIds.length === 0 || promotion.paymentOptionIds.includes(option.id));
}
