import { paymentMode, type PriceSnapshot } from "../domain/pricing.js";
import type { SaleCapability } from "../domain/sale-capability.js";

export type PaymentAdmission =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "method_unavailable" | "unsupported_amount";
      };
    };

/** New Product sales require one-time payment and the configured provider amount range. */
export function paymentAdmission(input: {
  readonly snapshot: Pick<PriceSnapshot, "paymentOption" | "firstPriceKopecks">;
  readonly sale: SaleCapability;
}): PaymentAdmission {
  if (
    !input.sale.payments ||
    paymentMode(input.snapshot.paymentOption) !== "one_time"
  )
    return { ok: false, error: { code: "method_unavailable" } };
  const limits = input.sale.amountLimits;
  if (
    limits !== undefined &&
    (input.snapshot.firstPriceKopecks < limits.minimumKopecks ||
      input.snapshot.firstPriceKopecks > limits.maximumKopecks)
  )
    return { ok: false, error: { code: "unsupported_amount" } };
  return { ok: true };
}
