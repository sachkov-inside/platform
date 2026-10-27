import { z } from "zod";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import { defineMutationOperation } from "@/shared/api/mutation-operation";

import { reconciledOutcomeSchema } from "../model/payment-contract";

/**
 * «Сверить с банком»: владелец просит billing перечитать состояние оплаты у банка. Команда
 * повторяемая и открытая миру банка; повтор с тем же `operationId` решает сервер.
 */
export const reconcilePaymentOperation = defineMutationOperation({
  input: z.strictObject({ operationId: z.uuid(), purchaseRef: z.uuid() }),
  method: "POST",
  path: "/api/authoring/billing/owner-payments/reconcile",
  result: billingCommandResultSchema(reconciledOutcomeSchema),
  transportFailure: billingTransportFailure,
});
