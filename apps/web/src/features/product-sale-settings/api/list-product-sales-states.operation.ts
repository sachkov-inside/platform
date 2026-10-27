import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
  productSalesStatesSchema,
} from "@/entities/subscription";

import { listProductSalesStatesInputSchema } from "../model/product-sale";

/** Страница публичных состояний продажи всех продуктов, без общего кеша, для списка продуктов. */
export const listProductSalesStatesOperation = defineMutationOperation({
  input: listProductSalesStatesInputSchema,
  method: "POST",
  path: "/api/authoring/billing/product-sales-states/list",
  result: billingCommandResultSchema(productSalesStatesSchema),
  transportFailure: billingTransportFailure,
});
