import { z } from "zod";
import { idSchema, priceSnapshotSchema } from "../../domain/pricing.js";
import { attemptStateSchema } from "../../domain/payment-attempt.js";

export const purchaseSubscriptionSchema = z.strictObject({
  operationId: idSchema, quoteRef: idSchema,
  // Подписка требует оферты и согласия на списания, разовая покупка — только оферты.
  contactRevision: z.int().positive(), consentEvidenceRefs: z.array(idSchema).min(1).max(4),
  acknowledgeExistingAccess: z.boolean(),
});
export type PurchaseSubscriptionCommand = z.infer<typeof purchaseSubscriptionSchema>;
export const purchaseStatusSchema = z.strictObject({
  purchaseRef: idSchema, state: attemptStateSchema,
  paymentUrl: z.url().nullable(), snapshot: priceSnapshotSchema,
  access: z.enum(["awaiting_payment", "preparing", "ready"]),
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(), periodEndsAt: z.iso.datetime().nullable(),
});
export type PurchaseStatus = z.infer<typeof purchaseStatusSchema>;
export const paymentFailureCodes = ["invalid_request", "forbidden", "not_found", "operation_conflict", "revision_conflict", "payment_in_progress",
  "contact_required", "consent_required", "existing_access", "legacy_review_required", "quote_expired", "quote_changed",
  "unsupported_amount", "method_unavailable", "provider_unavailable", "dependency_unavailable", "invalid_notification"] as const;
export type PaymentFailureCode = typeof paymentFailureCodes[number];
export type PaymentResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: PaymentFailureCode } };
export function paymentFailure(code: PaymentFailureCode): { readonly ok: false; readonly error: { readonly code: PaymentFailureCode } } {
  return { ok: false, error: { code } };
}
