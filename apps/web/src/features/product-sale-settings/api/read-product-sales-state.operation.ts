import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  readProductSalesStateInputSchema,
  productSalesStateOutcomeSchema,
} from "../model/product-sale";

/** Текущее состояние продажи одного продукта из публичного чтения, без общего кеша. */
export const readProductSalesStateOperation = defineMutationOperation({
  input: readProductSalesStateInputSchema,
  method: "POST",
  path: "/api/authoring/billing/product-sales-states/read",
  result: billingCommandResultSchema(productSalesStateOutcomeSchema),
  transportFailure: billingTransportFailure,
});
