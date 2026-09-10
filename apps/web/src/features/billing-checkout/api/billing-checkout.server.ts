import "server-only";

import {
  executeBillingCommand,
  readAuthenticatedBilling,
  readBillingResource,
} from "@/entities/subscription.server";
import {
  offersPageSchema,
  purchaseStatusSchema,
  quoteSchema,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  requestBillingOffers,
  requestBillingPurchase,
  requestBillingPurchaseStatus,
  requestBillingQuote,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import {
  purchaseInputSchema,
  purchaseRefSchema,
  quoteInputSchema,
} from "../model/checkout";

/** Витрина публична: цены приходят с сервера и не зависят от сессии покупателя. */
export function handleBillingOffers(): Promise<Response> {
  return readBillingResource(
    () => requestBillingOffers({ limit: 50 }),
    offersPageSchema,
  );
}

export function handleBillingQuote(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(form, quoteInputSchema, quoteSchema, (input) =>
      requestBillingQuote(
        {
          operationId: input.operationId,
          paymentOptionId: input.paymentOptionId,
          optionRevision: input.optionRevision,
          ...(input.promoCode === undefined
            ? {}
            : { promoCode: input.promoCode }),
        },
        accessToken,
      ),
    ),
  );
}

export function handleBillingPurchase(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(
      form,
      purchaseInputSchema,
      purchaseStatusSchema,
      (input) => requestBillingPurchase(input, accessToken),
    ),
  );
}

/** Возврат из банка не является подтверждением: состояние читается у сервера по ссылке покупки. */
export function handleBillingPurchaseStatus(
  request: Request,
): Promise<Response> {
  const purchaseRef = purchaseRefSchema.safeParse(
    new URL(request.url).searchParams.get("purchaseRef"),
  );
  if (!purchaseRef.success) {
    return Promise.resolve(
      Response.json(
        { ok: false, code: "not_found" },
        { headers: { "cache-control": "private, no-store", vary: "cookie" }, status: 404 },
      ),
    );
  }
  return readAuthenticatedBilling(
    (accessToken) =>
      requestBillingPurchaseStatus(purchaseRef.data, accessToken),
    purchaseStatusSchema,
  );
}

export type OffersResult =
  | { readonly kind: "ready"; readonly offers: readonly PriceSnapshot[] }
  | { readonly kind: "unavailable" };

/** Витрина рендерится сервером: цены и состав приходят из каталога, а не из разметки. */
export async function loadBillingOffers(): Promise<OffersResult> {
  try {
    const result = await requestBillingOffers({ limit: 50 });
    if (!result.ok) return { kind: "unavailable" };
    const parsed = offersPageSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", offers: parsed.data.items }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
