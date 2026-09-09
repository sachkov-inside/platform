import { HttpException } from "@nestjs/common";
import type { PaymentFailureCode } from "../features/purchase-subscription/purchase-subscription.contract.js";

export function throwPaymentError(code: PaymentFailureCode): never {
  let status: number;
  switch (code) {
    case "invalid_request": case "invalid_notification": status = 400; break;
    case "forbidden": status = 403; break;
    case "not_found": status = 404; break;
    case "operation_conflict": case "payment_in_progress": case "contact_required": case "consent_required":
    case "existing_access": case "legacy_review_required": case "quote_expired": case "quote_changed": status = 409; break;
    case "unsupported_amount": case "method_unavailable": status = 422; break;
    case "provider_unavailable": case "dependency_unavailable": status = 503; break;
    default: { const exhaustive: never = code; throw new Error(`Unknown billing result ${String(exhaustive)}`); }
  }
  throw new HttpException({ type: "about:blank", title: "Subscription payment request failed", status, code }, status);
}
