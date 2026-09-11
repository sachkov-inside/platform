import { z } from "zod";

import type { SameOriginMutationResult } from "@/shared/api/same-origin-mutation";

import {
  billingFailureCodeSchema,
  type BillingFailureCode,
} from "../model/billing-contract";

export type BillingCommandResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly code: BillingFailureCode };

function decode<Schema extends z.ZodType>(
  body: unknown,
  valueSchema: Schema,
): BillingCommandResult<z.infer<Schema>> {
  const failure = z
    .object({ ok: z.literal(false), code: billingFailureCodeSchema })
    .safeParse(body);
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
    : { ok: false, code: response.status === 401 ? "unauthorized" : "unavailable" };
}

/** Тот же разбор для собственного read: у него нет FormData, но исход такой же закрытый. */
export async function billingReadResult<Schema extends z.ZodType>(
  response: Response,
  valueSchema: Schema,
): Promise<BillingCommandResult<z.infer<Schema>>> {
  if (response.status === 401) return { ok: false, code: "unauthorized" };
  try {
    return decode(await response.json(), valueSchema);
  } catch {
    return { ok: false, code: "unavailable" };
  }
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
  try {
    const response = await fetch(route, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    return await billingReadResult(response, valueSchema);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
