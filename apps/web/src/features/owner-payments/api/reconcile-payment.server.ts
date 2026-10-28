import "server-only";

import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { reconcilePaymentOperation } from "./reconcile-payment.operation";

/** `POST /api/authoring/billing/owner-payments/reconcile`: ждёт ответа банка, как команда покупки. */
export function handleReconcilePayment(request: Request): Promise<Response> {
  return handleMutationOperation(request, reconcilePaymentOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(reconcilePaymentOperation, command, (input) =>
        requestManageBilling(
          {
            operation: "payments.reconcile",
            operationId: input.operationId,
            purchaseRef: input.purchaseRef,
          },
          accessToken,
          { bankCommand: true },
        ),
      ),
  });
}
