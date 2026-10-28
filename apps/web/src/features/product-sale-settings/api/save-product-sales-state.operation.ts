import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  saveProductSalesStateInputSchema,
  catalogOutcomeSchema,
} from "../model/product-sale";

/** Этап, поток, дата старта и событие: команда `productSalesState.save` с проверкой ревизии. */
export const saveProductSalesStateOperation = defineMutationOperation({
  input: saveProductSalesStateInputSchema,
  method: "POST",
  path: "/api/authoring/billing/product-sales-states/save",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
