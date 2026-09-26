import { problemException } from "../../../infrastructure/http/problem-details.js";
import type { PricingError } from "../domain/pricing.js";

export function throwPricingError(error: PricingError): never {
  let status: number;
  switch (error.code) {
    case "invalid_request":
      status = 400;
      break;
    case "forbidden":
      status = 403;
      break;
    case "not_found":
      status = 404;
      break;
    case "operation_conflict":
    case "revision_conflict":
    case "quote_changed":
    case "quote_expired":
    case "reservation_conflict":
      status = 409;
      break;
    case "unsupported_amount":
    case "method_unavailable":
      status = 422;
      break;
    case "dependency_unavailable":
      status = 503;
      break;
    default:
      return assertNever(error.code);
  }
  throw problemException(status, error.code, "Billing request failed");
}
function assertNever(value: never): never {
  throw new Error(`Unexpected pricing error: ${String(value)}`);
}
