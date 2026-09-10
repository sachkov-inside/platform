import { HttpException } from "@nestjs/common";
import type { OwnerFailureCode } from "../../domain/owner-operations.js";

export function throwOwnerError(code: OwnerFailureCode): never {
  let status: number;
  switch (code) {
    case "invalid_request": status = 400; break;
    case "forbidden": status = 403; break;
    case "not_found": status = 404; break;
    case "operation_conflict": case "revision_conflict": case "payment_in_progress": case "refund_in_progress":
    case "state_conflict": case "reservation_conflict": case "preview_expired": case "identity_changed": status = 409; break;
    case "unsupported_amount": case "method_unavailable": status = 422; break;
    case "provider_unavailable": case "dependency_unavailable": status = 503; break;
    default: { const exhaustive: never = code; throw new Error(`Unknown billing owner result ${String(exhaustive)}`); }
  }
  throw new HttpException({ type: "about:blank", title: "Billing owner operation failed", status, code }, status);
}
