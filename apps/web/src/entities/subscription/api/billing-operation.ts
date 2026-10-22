import { z } from "zod";

import type {
  MutationOperation,
  MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  billingFailureCodeSchema,
  type BillingFailureCode,
} from "../model/billing-contract";

/**
 * Result of one billing operation: a closed failure code or the value its schema accepts. A
 * value outside the schema is a contract failure, so it reads as unavailable, never as success.
 */
export function billingCommandResultSchema<Value extends z.ZodType>(
  value: Value,
) {
  return z.union([
    z.object({ ok: z.literal(false), code: billingFailureCodeSchema }),
    z.object({ ok: z.literal(true), value }),
  ]);
}

/** The result schema of any billing operation, whatever its value schema. */
export type BillingOperationResult = ReturnType<
  typeof billingCommandResultSchema<z.ZodType>
>;

/** A billing operation whose result carries the value schema `Value`. */
export type BillingOperation<
  Input extends z.ZodType,
  Value extends z.ZodType,
> = MutationOperation<
  Input,
  ReturnType<typeof billingCommandResultSchema<Value>>
>;

/** The value schema of a billing operation: the one owner of its success shape. */
export function billingOperationValue<Value extends z.ZodType>(
  operation: BillingOperation<z.ZodType, Value>,
): Value {
  return operation.result.options[1].shape.value;
}

/** A billing operation without an answer: only a missing session is named, the rest is unavailable. */
export function billingTransportFailure(failure: MutationTransportFailure): {
  readonly ok: false;
  readonly code: BillingFailureCode;
} {
  return {
    ok: false,
    code:
      failure.kind === "status" && failure.status === 401
        ? "unauthorized"
        : "unavailable",
  };
}
