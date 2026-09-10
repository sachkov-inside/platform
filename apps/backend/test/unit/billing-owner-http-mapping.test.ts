import { HttpException } from "@nestjs/common";
import { describe, expect, test } from "vitest";
import { ownerFailureCodes, type OwnerFailureCode } from "../../src/modules/billing/domain/owner-operations.js";
import { throwOwnerError } from "../../src/modules/billing/adapters/nest/owner-http.filter.js";

const expected: Record<OwnerFailureCode, number> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  operation_conflict: 409,
  revision_conflict: 409,
  payment_in_progress: 409,
  refund_in_progress: 409,
  state_conflict: 409,
  reservation_conflict: 409,
  preview_expired: 409,
  identity_changed: 409,
  unsupported_amount: 422,
  method_unavailable: 422,
  provider_unavailable: 503,
  dependency_unavailable: 503,
};

describe("billing owner result mapping", () => {
  test("maps every owner failure code to its status and problem body", () => {
    // Каждый код набора имеет своё отображение: новый код нельзя добавить молча.
    expect(Object.keys(expected).sort()).toEqual([...ownerFailureCodes].sort());
    for (const code of ownerFailureCodes) {
      let thrown: unknown;
      try { throwOwnerError(code); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(HttpException);
      const problem = thrown instanceof HttpException ? thrown.getResponse() : undefined;
      expect(thrown instanceof HttpException ? thrown.getStatus() : 0).toBe(expected[code]);
      expect(problem).toEqual({ type: "about:blank", title: "Billing owner operation failed", status: expected[code], code });
    }
  });
});
