import { paymentMode, type PriceSnapshot } from "../domain/pricing.js";
import type { SaleCapability } from "../domain/sale-capability.js";
import { type PurchaseGrounds } from "./offer-eligibility.js";

export type PaymentContext =
  "storefront" | "quote" | "purchase" | "resume" | "change" | "renewal";
export type PaymentAdmission =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "method_unavailable"
          | "not_eligible"
          | "legacy_review_required"
          | "unsupported_amount";
      };
    };

/** Одно правило для новой продажи и продолжения принятой подписки. Контакт и согласия quote ещё не требует. */
export function paymentAdmission(input: {
  readonly context: PaymentContext;
  readonly snapshot: Pick<
    PriceSnapshot,
    "offer" | "paymentOption" | "renewalPriceKopecks" | "individualPayment"
  > & { readonly firstPriceKopecks?: number };
  readonly sale: SaleCapability;
  readonly grounds: PurchaseGrounds;
  readonly recurringAllowed: boolean;
  readonly chargeKopecks?: number;
  readonly bindingAvailable?: boolean;
}): PaymentAdmission {
  const deny = (
    code: Extract<PaymentAdmission, { ok: false }>["error"]["code"],
  ): PaymentAdmission => ({ ok: false, error: { code } });
  const recurring =
    paymentMode(input.snapshot.paymentOption) === "subscription";
  if (!input.sale.payments || recurring) return deny("method_unavailable");
  const amounts =
    input.chargeKopecks === undefined
      ? recurring
        ? [
            input.snapshot.firstPriceKopecks ??
              input.snapshot.renewalPriceKopecks,
            input.snapshot.renewalPriceKopecks,
          ]
        : [
            input.snapshot.firstPriceKopecks ??
              input.snapshot.renewalPriceKopecks,
          ]
      : [input.chargeKopecks];
  const limits = input.sale.amountLimits;
  if (
    limits !== undefined &&
    amounts.some(
      (amount) =>
        amount < limits.minimumKopecks || amount > limits.maximumKopecks,
    )
  )
    return deny("unsupported_amount");
  return { ok: true };
}
