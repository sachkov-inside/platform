import "server-only";

import {
  billingFailureResponse,
  executeBillingCommand,
  readAuthenticatedBilling,
} from "@/entities/subscription.server";
import { purchaseStatusSchema, quoteSchema } from "@/entities/subscription";
import {
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
  if (!purchaseRef.success)
    return Promise.resolve(billingFailureResponse("not_found", 404));
  return readAuthenticatedBilling(
    (accessToken) =>
      requestBillingPurchaseStatus(purchaseRef.data, accessToken),
    purchaseStatusSchema,
  );
}
