import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { z } from "zod";

import type { SameOriginMutationResult } from "@/shared/api/same-origin-mutation";

import {
  billingFailureCodeSchema,
  type BillingFailureCode,
} from "../model/billing-contract";

export type BillingCommandResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly code: BillingFailureCode };

const failureSchema = z.object({
  ok: z.literal(false),
  code: billingFailureCodeSchema,
});

function decode<Schema extends z.ZodType>(
  body: unknown,
  valueSchema: Schema,
): BillingCommandResult<z.infer<Schema>> {
  const failure = failureSchema.safeParse(body);
  if (failure.success) return { ok: false, code: failure.data.code };
  const success = z
    .object({ ok: z.literal(true), value: z.unknown() })
    .safeParse(body);
  if (!success.success) return { ok: false, code: "unavailable" };
  const value = valueSchema.safeParse(success.data.value);
  return value.success
    ? { ok: true, value: value.data }
    : { ok: false, code: "unavailable" };
}

/** Ответ собственного BFF: закрытый исход или честная недоступность, но не «наверное успех». */
export function billingCommandResult<Schema extends z.ZodType>(
  response: SameOriginMutationResult,
  valueSchema: Schema,
): BillingCommandResult<z.infer<Schema>> {
  return response.ok
    ? decode(response.body, valueSchema)
    : {
        ok: false,
        code: response.status === 401 ? "unauthorized" : "unavailable",
      };
}

/** Одна форма команды billing: собственный BFF читает её как единственное поле `input`. */
export function billingCommandPayload(input: unknown): FormData {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  return form;
}

/** Собственный read через маршрут BFF: недоступность остаётся честной, а не пустым значением. */
export async function readBillingEndpoint<Schema extends z.ZodType>(
  route: string,
  valueSchema: Schema,
): Promise<BillingCommandResult<z.infer<Schema>>> {
  const result = await requestAuthenticatedRead(route);
  if (result.kind === "ready") return decode(result.value, valueSchema);
  if (result.kind === "rejected") {
    const failure = failureSchema.safeParse(result.body);
    return failure.success ? failure.data : { ok: false, code: "unavailable" };
  }
  return {
    ok: false,
    code:
      result.kind === "authentication_required"
        ? "unauthorized"
        : "unavailable",
  };
}
