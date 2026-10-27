import { z } from "zod";

import {
  billingFailureCodeSchema,
  type BillingFailureCode,
} from "@/entities/subscription";

import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  paymentPageSchema,
  paymentProductsSchema,
  paymentsPageSchema,
  type PaymentPage,
  type PaymentProduct,
  type PaymentsPage,
} from "../model/payment-contract";
import {
  serializePaymentsListRequest,
  type PaymentsListRequest,
} from "../model/payment-filters";

/**
 * Исход чтения владельца billing в браузере. Отказ в праве — отдельный исход, а не пустой список;
 * сбой зависимости несёт код обращения, когда сервер его дал.
 */
export type OwnerReadState<Value> =
  | { readonly kind: "ready"; readonly value: Value }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_request" }
  | { readonly kind: "unavailable"; readonly reference?: string };

/** Отказы, у которых есть свой исход; остальные коды читаются как недоступность. */
const failureKinds: Partial<
  Record<
    BillingFailureCode,
    "signed_out" | "forbidden" | "not_found" | "invalid_request"
  >
> = {
  unauthorized: "signed_out",
  forbidden: "forbidden",
  not_found: "not_found",
  invalid_request: "invalid_request",
};

const ownerReadsPath = "/api/authoring/billing/owner-payments";

/** Одно чтение через BFF billing: конверт `{ ok, value | code }` и схема значения. */
export async function requestOwnerRead<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<OwnerReadState<z.output<Schema>>> {
  const result = await requestAuthenticatedRead(url, signal);
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind !== "ready" && result.kind !== "rejected")
    return {
      kind: "unavailable",
      ...(result.reference === undefined
        ? {}
        : { reference: result.reference }),
    };
  const body = result.kind === "ready" ? result.value : result.body;
  const reference = result.kind === "rejected" ? result.reference : undefined;
  const envelope = z.object({ ok: z.literal(true), value: z.unknown() });
  const ready = envelope.safeParse(body);
  if (ready.success) {
    const value = schema.safeParse(ready.data.value);
    return value.success
      ? { kind: "ready", value: value.data }
      : { kind: "unavailable", reference: "malformed-response" };
  }
  const failure = z
    .object({ ok: z.literal(false), code: billingFailureCodeSchema })
    .safeParse(body);
  if (!failure.success)
    return { kind: "unavailable", reference: "malformed-response" };
  const kind = failureKinds[failure.data.code];
  if (kind !== undefined) return { kind };
  return {
    kind: "unavailable",
    ...(reference === undefined ? {} : { reference }),
  };
}

export function requestOwnerPayments(
  request: PaymentsListRequest,
  signal?: AbortSignal,
): Promise<OwnerReadState<PaymentsPage>> {
  return requestOwnerRead(
    `${ownerReadsPath}?${serializePaymentsListRequest(request)}`,
    paymentsPageSchema,
    signal,
  );
}

export function requestOwnerPaymentProducts(
  signal?: AbortSignal,
): Promise<OwnerReadState<PaymentProduct[]>> {
  return requestOwnerRead(
    `${ownerReadsPath}/products`,
    paymentProductsSchema,
    signal,
  );
}

export function requestOwnerPayment(
  purchaseRef: string,
  auditAfter: string | null,
  signal?: AbortSignal,
): Promise<OwnerReadState<PaymentPage>> {
  const path = `${ownerReadsPath}/${encodeURIComponent(purchaseRef)}`;
  return requestOwnerRead(
    auditAfter === null
      ? path
      : `${path}?auditAfter=${encodeURIComponent(auditAfter)}`,
    paymentPageSchema,
    signal,
  );
}
